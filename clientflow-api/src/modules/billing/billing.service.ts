import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { isPrismaUniqueViolation } from '../../common/prisma-errors';
import type {
  CfBillingFrequency,
  CfEnrollmentBillingAgreement,
  CfPaymentMethod,
  CfPaymentRecord,
  CfPaymentSource,
} from '../../generated/clientflow';
import {
  computeNextDueDate,
  computeOccurrences,
  getPeriodBoundsForOccurrence,
  type BillingSchedule,
} from './billing-schedule.util';

export interface UpsertProgramConfigInput {
  defaultAmount?: number;
  frequency?: CfBillingFrequency;
  customIntervalDays?: number | null;
  billingRequired?: boolean;
  defaultDueDay?: number | null;
  allowCustomClientPricing?: boolean;
  active?: boolean;
}

export interface ReplaceAgreementInput {
  organizationId: string;
  enrollmentId: string;
  amount: number;
  frequency: CfBillingFrequency;
  customIntervalDays?: number | null;
  startDate: Date;
  defaultDueDay?: number | null;
  timezone: string;
  actorUserId: string | null;
  actorDisplayName: string;
}

export interface RecordPaymentInput {
  organizationId: string;
  enrollmentId: string;
  amount: number;
  paymentDate: Date;
  paymentMethod: CfPaymentMethod;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  note?: string | null;
  source?: CfPaymentSource;
  timezone: string;
  actorUserId: string | null;
  actorDisplayName: string;
  /** The request's Idempotency-Key: a retry returns the payment already recorded. */
  idempotencyKey?: string | null;
}

export interface OpenPeriod {
  dueDate: Date;
  billingPeriodStart: Date;
  billingPeriodEnd: Date;
  amount: number;
  paidAmount: number;
  status: 'paid' | 'partial' | 'due' | 'overdue';
}

export interface BackfillSelection {
  paidThroughDate?: Date;
  periods?: Array<{ start: Date; end: Date }>;
}

export interface BackfillPreview {
  periods: Array<{ start: Date; end: Date; amount: number }>;
  totalAmount: number;
  count: number;
}

const roundCents = (value: number) => Math.round(value * 100) / 100;

/** Builds the pure schedule shape billing-schedule.util needs from a persisted agreement row. */
function scheduleFrom(
  agreement: Pick<CfEnrollmentBillingAgreement, 'startDate' | 'frequency' | 'customIntervalDays' | 'defaultDueDay'>,
  timezone: string,
): BillingSchedule {
  return {
    startDate: agreement.startDate,
    frequency: agreement.frequency as BillingSchedule['frequency'],
    customIntervalDays: agreement.customIntervalDays,
    defaultDueDay: agreement.defaultDueDay,
    timezone,
  };
}

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async resolveOrgTimezone(organizationId: string): Promise<string> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    const settings =
      organization?.settings && typeof organization.settings === 'object'
        ? (organization.settings as Record<string, unknown>)
        : {};
    return typeof settings.timezone === 'string' && isValidTimezone(settings.timezone) ? settings.timezone : 'UTC';
  }

  async requireEnrollmentForClient(organizationId: string, clientId: string, enrollmentId: string) {
    const enrollment = await this.prisma.cfProgramEnrollment.findFirst({
      where: { id: enrollmentId, clientId, organizationId },
    });
    if (!enrollment) throw new NotFoundException('Enrollment not found for this client.');
    return enrollment;
  }

  async requireProgramForOrg(organizationId: string, programId: string) {
    const program = await this.prisma.cfProgram.findFirst({ where: { id: programId, organizationId } });
    if (!program) throw new NotFoundException('Program not found.');
    return program;
  }

  // ─── Program billing config ────────────────────────────────────────────────

  async getOrCreateProgramConfig(organizationId: string, programId: string) {
    const existing = await this.prisma.cfProgramBillingConfig.findFirst({ where: { organizationId, programId } });
    if (existing) return existing;
    return this.prisma.cfProgramBillingConfig.create({ data: { organizationId, programId } });
  }

  async updateProgramConfig(organizationId: string, programId: string, input: UpsertProgramConfigInput) {
    const config = await this.getOrCreateProgramConfig(organizationId, programId);
    return this.prisma.cfProgramBillingConfig.update({
      where: { id: config.id },
      data: {
        ...(input.defaultAmount !== undefined ? { defaultAmount: input.defaultAmount } : {}),
        ...(input.frequency !== undefined ? { frequency: input.frequency } : {}),
        ...(input.customIntervalDays !== undefined ? { customIntervalDays: input.customIntervalDays } : {}),
        ...(input.billingRequired !== undefined ? { billingRequired: input.billingRequired } : {}),
        ...(input.defaultDueDay !== undefined ? { defaultDueDay: input.defaultDueDay } : {}),
        ...(input.allowCustomClientPricing !== undefined
          ? { allowCustomClientPricing: input.allowCustomClientPricing }
          : {}),
        ...(input.active !== undefined ? { active: input.active } : {}),
      },
    });
  }

  // ─── Enrollment billing agreements (append-only for financial terms) ──────

  async getActiveAgreement(organizationId: string, enrollmentId: string) {
    return this.prisma.cfEnrollmentBillingAgreement.findFirst({
      where: { organizationId, enrollmentId, status: 'active' },
    });
  }

  async listAgreementHistory(organizationId: string, enrollmentId: string) {
    return this.prisma.cfEnrollmentBillingAgreement.findMany({
      where: { organizationId, enrollmentId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /**
   * Ends any current active agreement and inserts a brand-new row. Financial terms are never
   * updated in place — this is what "Update Agreement" in the UI actually does.
   */
  async replaceAgreement(input: ReplaceAgreementInput): Promise<CfEnrollmentBillingAgreement> {
    const nextDueDate = computeNextDueDate({
      startDate: input.startDate,
      frequency: input.frequency as BillingSchedule['frequency'],
      customIntervalDays: input.customIntervalDays,
      defaultDueDay: input.defaultDueDay,
      timezone: input.timezone,
    });

    return this.prisma.$transaction(async (tx) => {
      const current = await tx.cfEnrollmentBillingAgreement.findFirst({
        where: { organizationId: input.organizationId, enrollmentId: input.enrollmentId, status: 'active' },
      });
      if (current) {
        await tx.cfEnrollmentBillingAgreement.update({
          where: { id: current.id },
          data: { status: 'ended', endDate: new Date() },
        });
      }
      return tx.cfEnrollmentBillingAgreement.create({
        data: {
          organizationId: input.organizationId,
          enrollmentId: input.enrollmentId,
          amount: input.amount,
          frequency: input.frequency,
          customIntervalDays: input.customIntervalDays ?? null,
          startDate: input.startDate,
          defaultDueDay: input.defaultDueDay ?? null,
          nextDueDate,
          createdByUserId: input.actorUserId,
          createdByDisplayName: input.actorDisplayName,
        },
      });
    });
  }

  async endAgreement(organizationId: string, enrollmentId: string) {
    const current = await this.getActiveAgreement(organizationId, enrollmentId);
    if (!current) throw new NotFoundException('No active billing agreement to end.');
    return this.prisma.cfEnrollmentBillingAgreement.update({
      where: { id: current.id },
      data: { status: 'ended', endDate: new Date() },
    });
  }

  // ─── Payments ───────────────────────────────────────────────────────────────

  async listPaymentsForEnrollment(organizationId: string, enrollmentId: string) {
    return this.prisma.cfPaymentRecord.findMany({
      where: { organizationId, enrollmentId },
      orderBy: { paymentDate: 'desc' },
    });
  }

  async listPaymentsForEnrollments(organizationId: string, enrollmentIds: string[]) {
    if (enrollmentIds.length === 0) return [];
    return this.prisma.cfPaymentRecord.findMany({
      where: { organizationId, enrollmentId: { in: enrollmentIds } },
      orderBy: { paymentDate: 'desc' },
    });
  }

  async recordPayment(input: RecordPaymentInput): Promise<CfPaymentRecord> {
    const recorded = await this.findPaymentByKey(input.organizationId, input.idempotencyKey);
    if (recorded) return recorded;

    if (input.billingPeriodStart.getTime() > input.billingPeriodEnd.getTime()) {
      throw new BadRequestException('The billing period must start before it ends.');
    }
    // A payment is recorded once it has arrived; a date beyond tomorrow is a typo, not a payment.
    if (input.paymentDate.getTime() > Date.now() + 86_400_000) {
      throw new BadRequestException('The payment date cannot be in the future.');
    }

    const agreement = await this.getActiveAgreement(input.organizationId, input.enrollmentId);
    if (!agreement) throw new BadRequestException('Set up a billing agreement before recording payments.');

    const schedule = scheduleFrom(agreement, input.timezone);
    const matchingOccurrences = computeOccurrences(schedule, input.billingPeriodStart, input.billingPeriodEnd);
    if (matchingOccurrences.length === 0) {
      throw new BadRequestException("The selected billing period does not match this agreement's schedule.");
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        const payment = await tx.cfPaymentRecord.create({
          data: {
            organizationId: input.organizationId,
            enrollmentId: input.enrollmentId,
            billingAgreementId: agreement.id,
            amount: input.amount,
            paymentDate: input.paymentDate,
            paymentMethod: input.paymentMethod,
            billingPeriodStart: input.billingPeriodStart,
            billingPeriodEnd: input.billingPeriodEnd,
            source: input.source ?? 'manual',
            note: input.note ?? null,
            recordedByUserId: input.actorUserId,
            recordedByDisplayName: input.actorDisplayName,
            idempotencyKey: input.idempotencyKey ?? null,
          },
        });
        await tx.cfEnrollmentBillingAgreement.update({
          where: { id: agreement.id },
          data: { nextDueDate: computeNextDueDate(schedule) },
        });
        return payment;
      });
    } catch (error) {
      // Two identical requests at once: the unique key let one record it; return that one.
      if (input.idempotencyKey && isPrismaUniqueViolation(error)) {
        const concurrent = await this.findPaymentByKey(input.organizationId, input.idempotencyKey);
        if (concurrent) return concurrent;
      }
      throw error;
    }
  }

  private async findPaymentByKey(organizationId: string, idempotencyKey?: string | null) {
    if (!idempotencyKey) return null;
    return this.prisma.cfPaymentRecord.findFirst({ where: { organizationId, idempotencyKey } });
  }

  async voidPayment(
    organizationId: string,
    paymentId: string,
    reason: string,
    actorUserId: string | null,
    actorDisplayName: string,
  ) {
    const payment = await this.prisma.cfPaymentRecord.findFirst({ where: { id: paymentId, organizationId } });
    if (!payment) throw new NotFoundException('Payment record not found.');
    if (payment.voidedAt) throw new BadRequestException('Payment is already voided.');
    // Conditional: two staff voiding at once can't both record a void (or overwrite the reason).
    const { count } = await this.prisma.cfPaymentRecord.updateMany({
      where: { id: payment.id, organizationId, voidedAt: null },
      data: {
        voidedAt: new Date(),
        voidedByUserId: actorUserId,
        voidedByDisplayName: actorDisplayName,
        voidReason: reason,
      },
    });
    if (count !== 1) throw new BadRequestException('Payment is already voided.');
    const voided = await this.prisma.cfPaymentRecord.findFirstOrThrow({ where: { id: payment.id, organizationId } });
    // The cached nextDueDate can go stale if the voided payment had covered the current period —
    // only bother recomputing while the agreement it belongs to is still the active one.
    const agreement = await this.prisma.cfEnrollmentBillingAgreement.findFirst({
      where: { id: payment.billingAgreementId, organizationId, status: 'active' },
    });
    if (agreement) {
      const timezone = await this.resolveOrgTimezone(organizationId);
      await this.prisma.cfEnrollmentBillingAgreement.update({
        where: { id: agreement.id },
        data: { nextDueDate: computeNextDueDate(scheduleFrom(agreement, timezone)) },
      });
    }
    return voided;
  }

  // ─── Per-enrollment summary + open periods (Record Payment selector, backfill checklist) ──

  async getEnrollmentBillingSummary(organizationId: string, enrollmentId: string, timezone: string) {
    const agreement = await this.getActiveAgreement(organizationId, enrollmentId);
    const payments = await this.listPaymentsForEnrollment(organizationId, enrollmentId);

    if (!agreement) {
      return { agreement: null, payments, collected: 0, expected: 0, outstanding: 0, nextDueDate: null };
    }

    const activePayments = payments.filter((payment) => !payment.voidedAt);
    const now = new Date();
    const schedule = scheduleFrom(agreement, timezone);
    const occurrences = computeOccurrences(schedule, agreement.startDate, now);
    const expected = occurrences.length * Number(agreement.amount);
    const collected = activePayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
    // "Applied" mirrors the org dashboard's Outstanding definition: only payments whose
    // obligation is already due count against Outstanding, regardless of when cash arrived.
    // Only this agreement's payments settle this agreement's obligations (a replaced agreement's
    // payments stay in `collected` but can't hide what the current one is owed).
    const applied = activePayments
      .filter((payment) => payment.billingAgreementId === agreement.id && payment.billingPeriodStart <= now)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const outstanding = Math.max(0, expected - applied);

    return { agreement, payments, collected, expected, outstanding, nextDueDate: agreement.nextDueDate };
  }

  async listOpenPeriods(
    organizationId: string,
    enrollmentId: string,
    timezone: string,
    throughDate?: Date,
  ): Promise<OpenPeriod[]> {
    const agreement = await this.getActiveAgreement(organizationId, enrollmentId);
    if (!agreement) return [];
    const schedule = scheduleFrom(agreement, timezone);
    const payments = (await this.listPaymentsForEnrollment(organizationId, enrollmentId)).filter(
      (payment) => !payment.voidedAt,
    );
    const amount = Number(agreement.amount);
    const now = new Date();
    // Default range always reaches at least the next upcoming due date (not just "now") so staff
    // can record a prepayment ahead of schedule; an explicit throughDate (e.g. legacy backfill,
    // which should never offer not-yet-due future periods) overrides this extension.
    const upcoming = computeNextDueDate(schedule, now);
    const effectiveThroughDate = throughDate ?? (upcoming && upcoming > now ? upcoming : now);

    return computeOccurrences(schedule, agreement.startDate, effectiveThroughDate).map((dueDate) => {
      const bounds = getPeriodBoundsForOccurrence(schedule, dueDate);
      const paidAmount = payments
        .filter(
          (payment) =>
            payment.billingPeriodStart.getTime() === bounds.start.getTime()
            && payment.billingPeriodEnd.getTime() === bounds.end.getTime(),
        )
        .reduce((sum, payment) => sum + Number(payment.amount), 0);
      const status: OpenPeriod['status'] =
        paidAmount >= amount ? 'paid' : paidAmount > 0 ? 'partial' : dueDate < now ? 'overdue' : 'due';
      return { dueDate, billingPeriodStart: bounds.start, billingPeriodEnd: bounds.end, amount, paidAmount, status };
    });
  }

  // ─── Legacy backfill ("Bring Account Current") ─────────────────────────────

  async previewBackfill(
    organizationId: string,
    enrollmentId: string,
    timezone: string,
    selection: BackfillSelection,
  ): Promise<BackfillPreview> {
    const agreement = await this.getActiveAgreement(organizationId, enrollmentId);
    if (!agreement) throw new BadRequestException('Set up a billing agreement before backfilling payment history.');

    const open = await this.listOpenPeriods(organizationId, enrollmentId, timezone, selection.paidThroughDate ?? new Date());
    const unpaid = open.filter((period) => period.status !== 'paid');

    const selected =
      selection.periods && selection.periods.length > 0
        ? unpaid.filter((period) =>
            selection.periods!.some(
              (pick) =>
                pick.start.getTime() === period.billingPeriodStart.getTime()
                && pick.end.getTime() === period.billingPeriodEnd.getTime(),
            ),
          )
        : unpaid;

    return {
      // A partly paid period is brought current by what's still owed, not the full amount again.
      periods: selected.map((period) => ({
        start: period.billingPeriodStart,
        end: period.billingPeriodEnd,
        amount: roundCents(period.amount - period.paidAmount),
      })),
      totalAmount: roundCents(selected.reduce((sum, period) => sum + period.amount - period.paidAmount, 0)),
      count: selected.length,
    };
  }

  async confirmBackfill(
    organizationId: string,
    enrollmentId: string,
    timezone: string,
    selection: BackfillSelection,
    actorUserId: string | null,
    actorDisplayName: string,
  ): Promise<{ created: number; totalAmount: number }> {
    const agreement = await this.getActiveAgreement(organizationId, enrollmentId);
    if (!agreement) throw new BadRequestException('Set up a billing agreement before backfilling payment history.');
    // Re-derive server-side rather than trusting the caller's period list at face value.
    const preview = await this.previewBackfill(organizationId, enrollmentId, timezone, selection);
    if (preview.count === 0) return { created: 0, totalAmount: 0 };

    return this.prisma.$transaction(async (tx) => {
      // skipDuplicates (ON CONFLICT DO NOTHING): a period confirmed twice is skipped by the partial
      // unique index without aborting the transaction, which a caught error inside it would.
      const { count: created } = await tx.cfPaymentRecord.createMany({
        data: preview.periods.map((period) => ({
          organizationId,
          enrollmentId,
          billingAgreementId: agreement.id,
          amount: period.amount,
          paymentDate: period.end,
          paymentMethod: 'other' as const,
          billingPeriodStart: period.start,
          billingPeriodEnd: period.end,
          source: 'legacy_backfill' as const,
          note: 'Existing payment history confirmed during billing setup',
          recordedByUserId: actorUserId,
          recordedByDisplayName: actorDisplayName,
        })),
        skipDuplicates: true,
      });
      await tx.cfEnrollmentBillingAgreement.update({
        where: { id: agreement.id },
        data: { nextDueDate: computeNextDueDate(scheduleFrom(agreement, timezone)) },
      });
      return { created, totalAmount: preview.totalAmount };
    });
  }
}

/** A setting like "Eastern" isn't an IANA zone; every billing date calculation would throw on it. */
function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
