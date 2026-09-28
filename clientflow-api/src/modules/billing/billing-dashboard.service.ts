import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { CfEnrollmentBillingAgreement } from '../../generated/clientflow';
import {
  computeOccurrences,
  getCalendarPeriodBounds,
  normalizeToMonthlyEquivalent,
  type BillingSchedule,
  type CalendarPeriodKind,
} from './billing-schedule.util';

export interface OrgDashboard {
  period: CalendarPeriodKind;
  periodStart: string;
  periodEnd: string;
  revenue: {
    received: number;
    expected: number;
    outstanding: number;
    activeRecurringRevenue: number;
  };
  expectedPayments: Array<{
    clientId: string;
    clientName: string;
    programId: string;
    programName: string;
    enrollmentId: string;
    period: string;
    dueDate: string;
    amount: number;
    status: 'paid' | 'partial' | 'due' | 'overdue';
  }>;
  /** Cash received in the period per program, from recorded (non-voided) payments. */
  receivedByProgram: Array<{
    programId: string;
    programName: string;
    received: number;
    payingClients: number;
  }>;
  /** Distinct clients with an active billing agreement. */
  payingClients: number;
  needsBillingSetup: Array<{
    clientId: string;
    clientName: string;
    programId: string;
    programName: string;
    enrollmentId: string;
    enrollmentDate: string | null;
  }>;
}

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

function periodLabel(frequency: string, dueDate: Date, timezone: string): string {
  if (frequency === 'monthly' || frequency === 'quarterly' || frequency === 'annually') {
    return new Intl.DateTimeFormat('en-US', { month: 'short', year: 'numeric', timeZone: timezone }).format(dueDate);
  }
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: timezone }).format(dueDate);
}

@Injectable()
export class BillingDashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async getOrgDashboard(organizationId: string, timezone: string, period: CalendarPeriodKind): Promise<OrgDashboard> {
    const { start: periodStart, end: periodEnd } = getCalendarPeriodBounds(period, new Date(), timezone);
    const now = new Date();

    const [agreements, payments, enrollments, programs, clients, configs] = await Promise.all([
      this.prisma.cfEnrollmentBillingAgreement.findMany({ where: { organizationId } }),
      this.prisma.cfPaymentRecord.findMany({ where: { organizationId, voidedAt: null } }),
      this.prisma.cfProgramEnrollment.findMany({ where: { organizationId, isArchived: false } }),
      this.prisma.cfProgram.findMany({ where: { organizationId } }),
      this.prisma.cfClient.findMany({ where: { organizationId, isArchived: false } }),
      this.prisma.cfProgramBillingConfig.findMany({ where: { organizationId } }),
    ]);

    const programById = new Map(programs.map((program) => [program.id, program]));
    const clientById = new Map(clients.map((client) => [client.id, client]));
    const enrollmentById = new Map(enrollments.map((enrollment) => [enrollment.id, enrollment]));
    const configByProgramId = new Map(configs.map((config) => [config.programId, config]));

    // Received: cash-basis, whenever the money actually arrived within the period.
    const paymentsInPeriod = payments.filter(
      (payment) => payment.paymentDate >= periodStart && payment.paymentDate <= periodEnd,
    );
    const received = paymentsInPeriod.reduce((sum, payment) => sum + Number(payment.amount), 0);

    let expected = 0;
    let obligationsThroughPeriodEnd = 0;
    let activeRecurringRevenue = 0;
    const expectedPayments: OrgDashboard['expectedPayments'] = [];

    for (const agreement of agreements) {
      const enrollment = enrollmentById.get(agreement.enrollmentId);
      if (!enrollment) continue;
      const schedule = scheduleFrom(agreement, timezone);
      // An ended agreement's schedule stops applying at its own endDate.
      const agreementBound = agreement.endDate && agreement.endDate < periodEnd ? agreement.endDate : periodEnd;

      const occurrencesInPeriod = computeOccurrences(schedule, periodStart, agreementBound < periodStart ? periodStart : agreementBound)
        .filter((due) => due >= periodStart && due <= periodEnd);
      expected += occurrencesInPeriod.length * Number(agreement.amount);

      const occurrencesToDate = computeOccurrences(schedule, agreement.startDate, agreementBound);
      obligationsThroughPeriodEnd += occurrencesToDate.length * Number(agreement.amount);

      if (agreement.status === 'active') {
        activeRecurringRevenue += normalizeToMonthlyEquivalent(Number(agreement.amount), agreement.frequency, agreement.customIntervalDays);
      }

      if (agreement.status !== 'active') continue;
      const client = clientById.get(enrollment.clientId);
      const program = programById.get(enrollment.programId);
      if (!client || !program) continue;
      for (const dueDate of occurrencesInPeriod) {
        // Sum (not just check existence) so a partial payment isn't mislabeled as fully paid.
        const appliedAmount = payments
          .filter(
            (payment) =>
              payment.enrollmentId === agreement.enrollmentId
              && payment.billingPeriodStart <= dueDate
              && payment.billingPeriodEnd >= dueDate,
          )
          .reduce((sum, payment) => sum + Number(payment.amount), 0);
        const dueAmount = Number(agreement.amount);
        const status: OrgDashboard['expectedPayments'][number]['status'] =
          appliedAmount >= dueAmount ? 'paid' : appliedAmount > 0 ? 'partial' : dueDate < now ? 'overdue' : 'due';
        expectedPayments.push({
          clientId: client.id,
          clientName: client.businessName,
          programId: program.id,
          programName: program.name,
          enrollmentId: enrollment.id,
          period: periodLabel(agreement.frequency, dueDate, timezone),
          dueDate: dueDate.toISOString(),
          amount: dueAmount,
          status,
        });
      }
    }

    // Applied = payments whose obligation is already due — mirrors the per-enrollment definition,
    // so a payment made early against a future period doesn't distort this period's outstanding.
    const appliedThroughPeriodEnd = payments
      .filter((payment) => payment.billingPeriodStart <= periodEnd)
      .reduce((sum, payment) => sum + Number(payment.amount), 0);
    const outstanding = Math.max(0, obligationsThroughPeriodEnd - appliedThroughPeriodEnd);

    const agreedEnrollmentIds = new Set(agreements.map((agreement) => agreement.enrollmentId));
    const needsBillingSetup: OrgDashboard['needsBillingSetup'] = [];
    for (const enrollment of enrollments) {
      if (agreedEnrollmentIds.has(enrollment.id)) continue;
      const program = programById.get(enrollment.programId);
      const client = clientById.get(enrollment.clientId);
      if (!program || !client) continue;
      const billingRequired = configByProgramId.get(program.id)?.billingRequired ?? true;
      if (!billingRequired) continue;
      needsBillingSetup.push({
        clientId: client.id,
        clientName: client.businessName,
        programId: program.id,
        programName: program.name,
        enrollmentId: enrollment.id,
        enrollmentDate: enrollment.startDate ? enrollment.startDate.toISOString() : null,
      });
    }

    // Payments on archived enrollments still count as money received; look those enrollments up too.
    const missingEnrollmentIds = [
      ...new Set(paymentsInPeriod.map((payment) => payment.enrollmentId).filter((id) => !enrollmentById.has(id))),
    ];
    const paymentEnrollments = new Map(enrollmentById);
    if (missingEnrollmentIds.length) {
      const archived = await this.prisma.cfProgramEnrollment.findMany({
        where: { organizationId, id: { in: missingEnrollmentIds } },
      });
      for (const enrollment of archived) paymentEnrollments.set(enrollment.id, enrollment);
    }
    const byProgram = new Map<string, { received: number; clients: Set<string> }>();
    for (const payment of paymentsInPeriod) {
      const enrollment = paymentEnrollments.get(payment.enrollmentId);
      if (!enrollment) continue;
      const entry = byProgram.get(enrollment.programId) ?? { received: 0, clients: new Set<string>() };
      entry.received += Number(payment.amount);
      entry.clients.add(enrollment.clientId);
      byProgram.set(enrollment.programId, entry);
    }
    const receivedByProgram = [...byProgram.entries()]
      .map(([programId, entry]) => ({
        programId,
        programName: programById.get(programId)?.name ?? 'Unknown program',
        received: entry.received,
        payingClients: entry.clients.size,
      }))
      .sort((a, b) => b.received - a.received);

    const payingClients = new Set(
      agreements
        .filter((agreement) => agreement.status === 'active')
        .map((agreement) => enrollmentById.get(agreement.enrollmentId)?.clientId)
        .filter((clientId): clientId is string => Boolean(clientId)),
    ).size;

    return {
      period,
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      revenue: { received, expected, outstanding, activeRecurringRevenue },
      expectedPayments,
      receivedByProgram,
      payingClients,
      needsBillingSetup,
    };
  }
}
