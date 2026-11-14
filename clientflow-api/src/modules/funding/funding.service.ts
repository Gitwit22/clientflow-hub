import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import type { CfAwardPayment, CfEnrollmentAward, CfPaymentMethod, Prisma } from '../../generated/clientflow';
import { isPrismaUniqueViolation } from '../../common/prisma-errors';
import { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { parseOrgDate } from '../billing/billing-schedule.util';
import { OPEN_CONTRACT_STATUSES } from '../lifecycle/contract-state';
import { lockAward } from './award-lock';
import {
  assertCanApprove,
  assertCanCancel,
  assertCanRecordPayment,
  assertWithinAward,
  AWARD_STATUS,
  outstandingOf,
  parsePositiveAmount,
  paymentStateOf,
  planAwardEdit,
  receivedOf,
  toAmount,
  type AwardEdit,
} from './award-rules';

export interface FundingActor {
  actorUserId: string | null;
  actorDisplayName: string;
}

type Tx = Prisma.TransactionClient;

export interface AwardPaymentView {
  id: string;
  awardId: string;
  amount: number;
  paymentDate: Date;
  paymentMethod: CfPaymentMethod;
  note: string | null;
  recordedByDisplayName: string;
  voidedAt: Date | null;
  voidedByDisplayName: string | null;
  voidReason: string | null;
  createdAt: Date;
}

export interface AwardView {
  id: string;
  clientId: string;
  enrollmentId: string;
  programId: string;
  title: string;
  source: string;
  amountAwarded: number;
  received: number;
  outstanding: number;
  paymentState: 'unpaid' | 'partially_paid' | 'paid';
  awardDate: Date;
  expectedPaymentDate: Date | null;
  notes: string;
  status: string;
  agreementTemplateId: string | null;
  currentAgreementId: string | null;
  approvedAt: Date | null;
  approvedByDisplayName: string | null;
  cancelledAt: Date | null;
  cancelledByDisplayName: string | null;
  cancelReason: string | null;
  createdByDisplayName: string;
  createdAt: Date;
  payments: AwardPaymentView[];
  documents: Array<{ id: string; name: string; type: string; uploadedAt: Date; uploadStatus: string }>;
}

export interface CreateAwardInput {
  title: unknown;
  source: unknown;
  amountAwarded: unknown;
  awardDate: unknown;
  expectedPaymentDate?: unknown;
  notes?: unknown;
  agreementTemplateId?: unknown;
  approve?: unknown;
}

export interface UpdateAwardInput {
  title?: unknown;
  source?: unknown;
  amountAwarded?: unknown;
  awardDate?: unknown;
  expectedPaymentDate?: unknown;
  notes?: unknown;
  agreementTemplateId?: unknown;
  replaceAgreement?: unknown;
}

export interface RecordAwardPaymentInput {
  amount: unknown;
  paymentDate: unknown;
  paymentMethod: CfPaymentMethod;
  note?: unknown;
}

const FUTURE_TOLERANCE_MS = 86_400_000;

/** An award for a list: its figures without the payment ledger and documents. */
function withoutLedger(view: AwardView): Omit<AwardView, 'payments' | 'documents'> {
  const summary: Partial<AwardView> = { ...view };
  delete summary.payments;
  delete summary.documents;
  return summary as Omit<AwardView, 'payments' | 'documents'>;
}

function requiredText(value: unknown, label: string, max = 200): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new BadRequestException(`${label} is required.`);
  if (text.length > max) throw new BadRequestException(`${label} can be at most ${max} characters.`);
  return text;
}

function optionalText(value: unknown, max = 5000): string {
  if (value === undefined || value === null) return '';
  if (typeof value !== 'string') throw new BadRequestException('Notes must be text.');
  if (value.length > max) throw new BadRequestException(`Notes can be at most ${max} characters.`);
  return value.trim();
}

function requiredAmount(value: unknown, label: string): Prisma.Decimal {
  const amount = parsePositiveAmount(value);
  if (!amount) throw new BadRequestException(`${label} must be a positive amount with at most two decimal places.`);
  return amount;
}

/**
 * Funding awards and their payments. Every change to an award or its ledger runs in a transaction
 * that first locks the award row, so two requests on one award (two payments, a payment and an
 * edit, a void and a cancel) are applied one after the other and the balance rules always hold.
 */
@Injectable()
export class FundingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly billing: BillingService,
  ) {}

  // ─── Reads ────────────────────────────────────────────────────────────────

  async listForEnrollment(organizationId: string, clientId: string, enrollmentId: string): Promise<AwardView[]> {
    await this.billing.requireEnrollmentForClient(organizationId, clientId, enrollmentId);
    const awards = await this.prisma.cfEnrollmentAward.findMany({
      where: { organizationId, clientId, enrollmentId },
      orderBy: [{ awardDate: 'desc' }, { createdAt: 'desc' }],
    });
    return this.views(organizationId, awards);
  }

  async get(organizationId: string, awardId: string): Promise<AwardView> {
    const award = await this.requireAward(this.prisma, organizationId, awardId);
    const [view] = await this.views(organizationId, [award]);
    return view;
  }

  /**
   * Every award with money still owed, across the organization, including enrollments that have
   * been archived: closing a participation never makes an unpaid award disappear.
   */
  async outstanding(organizationId: string) {
    const awards = await this.prisma.cfEnrollmentAward.findMany({
      where: { organizationId, status: { not: AWARD_STATUS.cancelled } },
      orderBy: [{ awardDate: 'asc' }, { createdAt: 'asc' }],
    });
    const views = (await this.views(organizationId, awards, { withDocuments: false })).filter((view) => view.outstanding > 0);
    if (!views.length) return [];
    const [clients, programs, enrollments] = await Promise.all([
      this.prisma.cfClient.findMany({
        where: { organizationId, id: { in: [...new Set(views.map((view) => view.clientId))] } },
        select: { id: true, businessName: true, isArchived: true },
      }),
      this.prisma.cfProgram.findMany({
        where: { organizationId, id: { in: [...new Set(views.map((view) => view.programId))] } },
        select: { id: true, name: true },
      }),
      this.prisma.cfProgramEnrollment.findMany({
        where: { organizationId, id: { in: [...new Set(views.map((view) => view.enrollmentId))] } },
        select: { id: true, isArchived: true, status: true },
      }),
    ]);
    const clientById = new Map(clients.map((client) => [client.id, client]));
    const programById = new Map(programs.map((program) => [program.id, program]));
    const enrollmentById = new Map(enrollments.map((enrollment) => [enrollment.id, enrollment]));
    return views.map((view) => ({
      ...withoutLedger(view),
      businessName: clientById.get(view.clientId)?.businessName ?? '',
      clientArchived: clientById.get(view.clientId)?.isArchived ?? false,
      programName: programById.get(view.programId)?.name ?? '',
      enrollmentArchived: enrollmentById.get(view.enrollmentId)?.isArchived ?? false,
      enrollmentStatus: enrollmentById.get(view.enrollmentId)?.status ?? null,
    }));
  }

  // ─── Awards ───────────────────────────────────────────────────────────────

  async create(
    organizationId: string,
    clientId: string,
    enrollmentId: string,
    input: CreateAwardInput,
    actor: FundingActor,
    idempotencyKey: string | null,
  ): Promise<AwardView> {
    if (idempotencyKey) {
      const existing = await this.prisma.cfEnrollmentAward.findFirst({ where: { organizationId, idempotencyKey } });
      if (existing) return this.get(organizationId, existing.id);
    }
    const enrollment = await this.billing.requireEnrollmentForClient(organizationId, clientId, enrollmentId);
    if (enrollment.isArchived) {
      throw new BadRequestException('This program participation is archived. Awards already given can still be paid.');
    }
    const timezone = await this.billing.resolveOrgTimezone(organizationId);
    const title = requiredText(input.title, 'Award title');
    const source = requiredText(input.source, 'Award source');
    const amountAwarded = requiredAmount(input.amountAwarded, 'Award amount');
    const awardDate = this.requiredDate(input.awardDate, 'Award date', timezone);
    const expectedPaymentDate = this.optionalDate(input.expectedPaymentDate, timezone);
    const notes = optionalText(input.notes);
    const agreementTemplateId = await this.validAgreementTemplate(organizationId, enrollment.programId, input.agreementTemplateId);
    const approve = input.approve === true;
    const now = new Date();
    const client = await this.prisma.cfClient.findFirst({ where: { id: clientId, organizationId }, select: { isDemo: true } });

    try {
      const award = await this.prisma.cfEnrollmentAward.create({
        data: {
          organizationId,
          clientId,
          enrollmentId,
          programId: enrollment.programId,
          title,
          source,
          amountAwarded,
          awardDate,
          expectedPaymentDate,
          notes,
          agreementTemplateId,
          status: approve ? AWARD_STATUS.approved : AWARD_STATUS.pending,
          ...(approve ? { approvedAt: now, approvedByUserId: actor.actorUserId, approvedByDisplayName: actor.actorDisplayName } : {}),
          createdByUserId: actor.actorUserId,
          createdByDisplayName: actor.actorDisplayName,
          idempotencyKey,
          isDemo: client?.isDemo ?? false,
        },
      });
      await this.log(this.prisma, award, 'AWARD_CREATED', `Award "${title}" of $${amountAwarded.toFixed(2)} from ${source} recorded.`, actor);
      return this.get(organizationId, award.id);
    } catch (error) {
      if (idempotencyKey && isPrismaUniqueViolation(error)) {
        const concurrent = await this.prisma.cfEnrollmentAward.findFirst({ where: { organizationId, idempotencyKey } });
        if (concurrent) return this.get(organizationId, concurrent.id);
      }
      throw error;
    }
  }

  async update(organizationId: string, awardId: string, input: UpdateAwardInput, actor: FundingActor): Promise<AwardView> {
    const timezone = await this.billing.resolveOrgTimezone(organizationId);
    const edit: AwardEdit = {};
    if (input.title !== undefined) edit.title = requiredText(input.title, 'Award title');
    if (input.source !== undefined) edit.source = requiredText(input.source, 'Award source');
    if (input.amountAwarded !== undefined) edit.amountAwarded = requiredAmount(input.amountAwarded, 'Award amount');
    if (input.awardDate !== undefined) edit.awardDate = this.requiredDate(input.awardDate, 'Award date', timezone);
    if (input.expectedPaymentDate !== undefined) edit.expectedPaymentDate = this.optionalDate(input.expectedPaymentDate, timezone);
    if (input.notes !== undefined) edit.notes = optionalText(input.notes);

    await this.prisma.$transaction(async (tx) => {
      const award = await this.lockAward(tx, organizationId, awardId);
      const received = receivedOf(await this.paymentsOf(tx, organizationId, award.id));
      const plan = planAwardEdit(award, edit, received, { replaceAgreement: input.replaceAgreement === true });
      let agreementTemplateId: string | null | undefined;
      if (input.agreementTemplateId !== undefined) {
        if (award.status === AWARD_STATUS.agreementSent || award.status === AWARD_STATUS.agreementSigned) {
          if (!plan.replacesAgreement && input.agreementTemplateId !== award.agreementTemplateId) {
            throw new BadRequestException('Replace the agreement to change which agreement template this award uses.');
          }
        }
        agreementTemplateId = await this.validAgreementTemplate(organizationId, award.programId, input.agreementTemplateId, tx);
      }
      await tx.cfEnrollmentAward.update({
        where: { id: award.id },
        data: {
          ...plan.data,
          ...(agreementTemplateId !== undefined ? { agreementTemplateId } : {}),
          ...(plan.replacesAgreement ? { status: AWARD_STATUS.approved, currentAgreementId: null } : {}),
        },
      });
      if (plan.replacesAgreement) await this.retireAgreement(tx, award);
      await this.log(
        tx,
        award,
        'AWARD_UPDATED',
        plan.replacesAgreement
          ? `Award "${award.title}" changed; its agreement must be prepared again.`
          : `Award "${award.title}" updated.`,
        actor,
      );
    });
    return this.get(organizationId, awardId);
  }

  async approve(organizationId: string, awardId: string, actor: FundingActor): Promise<AwardView> {
    await this.prisma.$transaction(async (tx) => {
      const award = await this.lockAward(tx, organizationId, awardId);
      assertCanApprove(award.status);
      await tx.cfEnrollmentAward.update({
        where: { id: award.id },
        data: {
          status: AWARD_STATUS.approved,
          approvedAt: new Date(),
          approvedByUserId: actor.actorUserId,
          approvedByDisplayName: actor.actorDisplayName,
        },
      });
      await this.log(tx, award, 'AWARD_APPROVED', `Award "${award.title}" approved.`, actor);
    });
    return this.get(organizationId, awardId);
  }

  async cancel(organizationId: string, awardId: string, reason: unknown, actor: FundingActor): Promise<AwardView> {
    const cancelReason = requiredText(reason, 'A reason', 1000);
    await this.prisma.$transaction(async (tx) => {
      const award = await this.lockAward(tx, organizationId, awardId);
      assertCanCancel(award.status, receivedOf(await this.paymentsOf(tx, organizationId, award.id)));
      await tx.cfEnrollmentAward.update({
        where: { id: award.id },
        data: {
          status: AWARD_STATUS.cancelled,
          cancelledAt: new Date(),
          cancelledByUserId: actor.actorUserId,
          cancelledByDisplayName: actor.actorDisplayName,
          cancelReason,
          currentAgreementId: null,
        },
      });
      await this.retireAgreement(tx, award);
      await this.log(tx, award, 'AWARD_CANCELLED', `Award "${award.title}" cancelled: ${cancelReason}`, actor);
    });
    return this.get(organizationId, awardId);
  }

  // ─── Payments ─────────────────────────────────────────────────────────────

  async recordPayment(
    organizationId: string,
    awardId: string,
    input: RecordAwardPaymentInput,
    actor: FundingActor,
    idempotencyKey: string | null,
  ): Promise<AwardView> {
    if (idempotencyKey) {
      const existing = await this.prisma.cfAwardPayment.findFirst({ where: { organizationId, idempotencyKey } });
      if (existing) return this.get(organizationId, existing.awardId);
    }
    const amount = requiredAmount(input.amount, 'Payment amount');
    const timezone = await this.billing.resolveOrgTimezone(organizationId);
    const paymentDate = this.requiredDate(input.paymentDate, 'Payment date', timezone);
    // A payment is recorded once it has been made; a date beyond tomorrow is a typo.
    if (paymentDate.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
      throw new BadRequestException('The payment date cannot be in the future.');
    }
    const note = optionalText(input.note, 1000) || null;

    try {
      await this.prisma.$transaction(async (tx) => {
        // Locked first: a second payment on this award waits here and then sees this one.
        const award = await this.lockAward(tx, organizationId, awardId);
        assertCanRecordPayment(award.status, await this.agreementNeedsSignature(tx, award));
        const received = receivedOf(await this.paymentsOf(tx, organizationId, award.id));
        assertWithinAward(award.amountAwarded, received, amount);
        await tx.cfAwardPayment.create({
          data: {
            organizationId,
            awardId: award.id,
            enrollmentId: award.enrollmentId,
            clientId: award.clientId,
            amount,
            paymentDate,
            paymentMethod: input.paymentMethod,
            note,
            recordedByUserId: actor.actorUserId,
            recordedByDisplayName: actor.actorDisplayName,
            idempotencyKey,
          },
        });
        await this.log(tx, award, 'AWARD_PAYMENT_RECORDED', `Payment of $${amount.toFixed(2)} recorded on award "${award.title}".`, actor);
      });
    } catch (error) {
      if (idempotencyKey && isPrismaUniqueViolation(error)) {
        const concurrent = await this.prisma.cfAwardPayment.findFirst({ where: { organizationId, idempotencyKey } });
        if (concurrent) return this.get(organizationId, concurrent.awardId);
      }
      throw error;
    }
    return this.get(organizationId, awardId);
  }

  async voidPayment(organizationId: string, paymentId: string, reason: unknown, actor: FundingActor): Promise<AwardView> {
    const voidReason = requiredText(reason, 'A reason', 1000);
    const payment = await this.prisma.cfAwardPayment.findFirst({ where: { id: paymentId, organizationId } });
    if (!payment) throw new NotFoundException('Award payment not found.');
    await this.prisma.$transaction(async (tx) => {
      const award = await this.lockAward(tx, organizationId, payment.awardId);
      // Conditional: two staff voiding at once can't both record a void.
      const { count } = await tx.cfAwardPayment.updateMany({
        where: { id: payment.id, organizationId, voidedAt: null },
        data: {
          voidedAt: new Date(),
          voidedByUserId: actor.actorUserId,
          voidedByDisplayName: actor.actorDisplayName,
          voidReason,
        },
      });
      if (count !== 1) throw new BadRequestException('This payment is already voided.');
      await this.log(tx, award, 'AWARD_PAYMENT_VOIDED', `Payment of $${toAmount(payment.amount).toFixed(2)} on award "${award.title}" voided: ${voidReason}`, actor);
    });
    return this.get(organizationId, payment.awardId);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private lockAward(tx: Tx, organizationId: string, awardId: string): Promise<CfEnrollmentAward> {
    return lockAward(tx, organizationId, awardId);
  }

  private async requireAward(db: Tx | PrismaService, organizationId: string, awardId: string) {
    const award = await db.cfEnrollmentAward.findFirst({ where: { id: awardId, organizationId } });
    if (!award) throw new NotFoundException('Award not found.');
    return award;
  }

  private paymentsOf(db: Tx | PrismaService, organizationId: string, awardId: string) {
    return db.cfAwardPayment.findMany({ where: { organizationId, awardId }, select: { amount: true, voidedAt: true } });
  }

  /** True unless the award's agreement template is marked as not needing a signature. */
  private async agreementNeedsSignature(tx: Tx, award: CfEnrollmentAward): Promise<boolean> {
    if (!award.agreementTemplateId) return true;
    const template = await tx.cfProgramContractTemplate.findFirst({
      where: { id: award.agreementTemplateId, organizationId: award.organizationId },
      select: { signatureRequired: true },
    });
    return template?.signatureRequired ?? true;
  }

  /**
   * Retires the award's current agreement when it is replaced or the award is cancelled. An
   * unsigned one is cancelled so its signing link stops working; a signed one stays as history.
   */
  private async retireAgreement(tx: Tx, award: CfEnrollmentAward): Promise<void> {
    await tx.cfContract.updateMany({
      where: {
        organizationId: award.organizationId,
        awardId: award.id,
        status: { in: [...OPEN_CONTRACT_STATUSES] },
      },
      data: { status: 'CANCELLED', secureTokenHash: null, secureTokenExpiresAt: null },
    });
  }

  private async validAgreementTemplate(
    organizationId: string,
    programId: string,
    value: unknown,
    db: Tx | PrismaService = this.prisma,
  ): Promise<string | null> {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value !== 'string') throw new BadRequestException('Choose an award agreement template from this program.');
    const template = await db.cfProgramContractTemplate.findFirst({
      where: { id: value, organizationId, programId, purpose: 'award', isActive: true },
      select: { id: true },
    });
    if (!template) throw new BadRequestException('Choose an award agreement template from this program.');
    return template.id;
  }

  private requiredDate(value: unknown, label: string, timezone: string): Date {
    const date = typeof value === 'string' && value.trim() ? parseOrgDate(value.trim(), timezone) : null;
    if (!date || Number.isNaN(date.getTime())) throw new BadRequestException(`${label} is required (YYYY-MM-DD).`);
    return date;
  }

  private optionalDate(value: unknown, timezone: string): Date | null {
    if (value === undefined || value === null || value === '') return null;
    return this.requiredDate(value, 'Date', timezone);
  }

  private async log(db: Tx | PrismaService, award: CfEnrollmentAward, action: string, description: string, actor: FundingActor) {
    await db.cfActivityLog.create({
      data: {
        organizationId: award.organizationId,
        clientId: award.clientId,
        enrollmentId: award.enrollmentId,
        actorUserId: actor.actorUserId,
        action,
        description,
        user: actor.actorDisplayName,
        source: 'manual_staff_action',
        isDemo: award.isDemo,
      },
    });
  }

  private async views(
    organizationId: string,
    awards: CfEnrollmentAward[],
    options: { withDocuments?: boolean } = {},
  ): Promise<AwardView[]> {
    if (!awards.length) return [];
    const ids = awards.map((award) => award.id);
    const [payments, documents] = await Promise.all([
      this.prisma.cfAwardPayment.findMany({
        where: { organizationId, awardId: { in: ids } },
        orderBy: [{ paymentDate: 'desc' }, { createdAt: 'desc' }],
      }),
      options.withDocuments === false
        ? Promise.resolve([])
        : this.prisma.cfDocument.findMany({
            where: { organizationId, awardId: { in: ids } },
            select: { id: true, name: true, type: true, uploadedAt: true, uploadStatus: true, awardId: true },
            orderBy: { uploadedAt: 'desc' },
          }),
    ]);
    return awards.map((award) => {
      const own = payments.filter((payment) => payment.awardId === award.id);
      const received = receivedOf(own);
      return {
        id: award.id,
        clientId: award.clientId,
        enrollmentId: award.enrollmentId,
        programId: award.programId,
        title: award.title,
        source: award.source,
        amountAwarded: toAmount(award.amountAwarded),
        received: toAmount(received),
        outstanding: toAmount(outstandingOf(award, received)),
        paymentState: paymentStateOf(award.amountAwarded, received),
        awardDate: award.awardDate,
        expectedPaymentDate: award.expectedPaymentDate,
        notes: award.notes,
        status: award.status,
        agreementTemplateId: award.agreementTemplateId,
        currentAgreementId: award.currentAgreementId,
        approvedAt: award.approvedAt,
        approvedByDisplayName: award.approvedByDisplayName,
        cancelledAt: award.cancelledAt,
        cancelledByDisplayName: award.cancelledByDisplayName,
        cancelReason: award.cancelReason,
        createdByDisplayName: award.createdByDisplayName,
        createdAt: award.createdAt,
        payments: own.map((payment) => this.paymentView(payment)),
        documents: documents
          .filter((document) => document.awardId === award.id)
          .map((document) => ({
            id: document.id,
            name: document.name,
            type: document.type,
            uploadedAt: document.uploadedAt,
            uploadStatus: document.uploadStatus,
          })),
      };
    });
  }

  private paymentView(payment: CfAwardPayment): AwardPaymentView {
    return {
      id: payment.id,
      awardId: payment.awardId,
      amount: toAmount(payment.amount),
      paymentDate: payment.paymentDate,
      paymentMethod: payment.paymentMethod,
      note: payment.note,
      recordedByDisplayName: payment.recordedByDisplayName,
      voidedAt: payment.voidedAt,
      voidedByDisplayName: payment.voidedByDisplayName,
      voidReason: payment.voidReason,
      createdAt: payment.createdAt,
    };
  }
}
