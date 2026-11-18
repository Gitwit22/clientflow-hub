import { PrismaClient } from '../../generated/clientflow';
import type { AuthenticatedRequest } from '../../common/guards/clientflow-auth.guard';
import type { PrismaService } from '../../prisma/prisma.service';
import { BillingDashboardService } from './billing-dashboard.service';
import { BillingDashboardController, EnrollmentBillingController, ProgramBillingController } from './billing.controller';
import { BillingService } from './billing.service';

/**
 * Billing amounts as the browser receives them, against a real, migrated Postgres (Prisma returns
 * DECIMAL columns as Decimal objects, which JSON turns into text). Set CLIENTFLOW_PG_TEST_URL to run it.
 */
const url = process.env.CLIENTFLOW_PG_TEST_URL;
const describePg = url ? describe : describe.skip;

/** What the frontend gets: the controller result after JSON encoding. */
const overTheWire = <T>(value: T) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

describePg('billing amounts reach the browser as numbers (Postgres)', () => {
  let prisma: PrismaClient;
  let programs: ProgramBillingController;
  let enrollments: EnrollmentBillingController;
  let dashboard: BillingDashboardController;
  let request: AuthenticatedRequest;
  let programId: string;
  let clientId: string;
  let enrollmentId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const db = prisma as unknown as PrismaService;
    const billing = new BillingService(db);
    programs = new ProgramBillingController(billing);
    enrollments = new EnrollmentBillingController(billing);
    dashboard = new BillingDashboardController(billing, new BillingDashboardService(db));
    const stamp = Date.now();
    const organizationId = (await prisma.organization.create({ data: { name: 'Billing', slug: `billing-${stamp}` } })).id;
    request = { adminUser: { id: null, organizationId, displayName: 'Jordan' } } as unknown as AuthenticatedRequest;
    programId = (await prisma.cfProgram.create({
      data: { organizationId, name: 'Membership', description: '', defaultFormTemplateId: '', defaultMonitoringFrequency: '', defaultContractTemplateId: '' },
    })).id;
    clientId = (await prisma.cfClient.create({
      data: { organizationId, businessName: 'Rivers Bakery', primaryContactName: 'Pat', email: `b-${stamp}@x.test`, phone: '', assignedStaff: '', intake: {} },
    })).id;
    enrollmentId = (await prisma.cfProgramEnrollment.create({ data: { organizationId, clientId, programId, status: 'active' } })).id;
  });
  afterAll(async () => prisma?.$disconnect());

  it('sends the program default fee, agreement amount and payment amounts as numbers', async () => {
    const config = overTheWire(await programs.update(request, programId, { defaultAmount: 1200.5, billingRequired: true, active: true }));
    expect(config.defaultAmount).toBe(1200.5);
    expect(overTheWire(await programs.get(request, programId)).defaultAmount).toBe(1200.5);

    const agreement = overTheWire(await enrollments.replaceAgreement(request, clientId, enrollmentId, {
      amount: 1200.5, frequency: 'monthly', startDate: '2026-10-01',
    } as never));
    expect(agreement.amount).toBe(1200.5);

    const payment = overTheWire(await enrollments.recordPayment(request, clientId, enrollmentId, {
      amount: 250.25, paymentDate: '2026-10-03', paymentMethod: 'check', billingPeriodStart: '2026-10-01', billingPeriodEnd: '2026-10-31',
    } as never));
    expect(payment.amount).toBe(250.25);

    const summary = overTheWire(await enrollments.getSummary(request, clientId, enrollmentId)) as {
      agreement: { amount: unknown };
      payments: Array<{ amount: unknown }>;
      collected: unknown;
    };
    expect(summary.agreement.amount).toBe(1200.5);
    expect(summary.payments.map((row) => row.amount)).toEqual([250.25]);
    expect(summary.collected).toBe(250.25);

    const voided = overTheWire(await dashboard.voidPayment(request, String(payment.id), { reason: 'Entered twice' }));
    expect(voided.amount).toBe(250.25);
    expect(voided.voidReason).toBe('Entered twice');
  });

  it('records a past payment with its real date, without an agreement, and never applies it to a period', async () => {
    const stamp = Date.now();
    const pastClientId = (await prisma.cfClient.create({
      data: { organizationId: request.adminUser!.organizationId, businessName: 'Old Payer', primaryContactName: 'Lee', email: `old-${stamp}@x.test`, phone: '', assignedStaff: '', intake: {} },
    })).id;
    const pastEnrollmentId = (await prisma.cfProgramEnrollment.create({
      data: { organizationId: request.adminUser!.organizationId, clientId: pastClientId, programId, status: 'active' },
    })).id;
    const key = `past-${stamp}`;
    const body = { amount: 75, paymentDate: '2025-03-15', paymentMethod: 'check', note: 'Paid before ClientFlow' } as never;

    // No billing agreement exists for this enrollment.
    const past = overTheWire(await enrollments.recordPastPayment(request, pastClientId, pastEnrollmentId, body, key));
    expect(past).toEqual(expect.objectContaining({ amount: 75, source: 'historical', billingAgreementId: null, billingPeriodStart: null, note: 'Paid before ClientFlow' }));
    expect(String(past.paymentDate).slice(0, 10)).toBe('2025-03-15');
    // The same request again records it once.
    const again = overTheWire(await enrollments.recordPastPayment(request, pastClientId, pastEnrollmentId, body, key));
    expect(again.id).toBe(past.id);
    const beforeAgreement = overTheWire(await enrollments.getSummary(request, pastClientId, pastEnrollmentId)) as { collected: number; agreement: unknown };
    expect(beforeAgreement).toEqual(expect.objectContaining({ agreement: null, collected: 75 }));

    // It counts as collected, but an agreement set up afterwards still owes its own periods.
    await enrollments.replaceAgreement(request, pastClientId, pastEnrollmentId, { amount: 100, frequency: 'monthly', startDate: '2026-10-01' } as never);
    const summary = overTheWire(await enrollments.getSummary(request, pastClientId, pastEnrollmentId)) as { collected: number; payments: unknown[]; outstanding: number; expected: number };
    expect(summary.collected).toBe(75);
    expect(summary.payments).toHaveLength(1);
    expect(summary.outstanding).toBe(summary.expected);
    const periods = await enrollments.getPeriods(request, pastClientId, pastEnrollmentId);
    expect(periods.every((period) => period.paidAmount === 0)).toBe(true);

    // A future date is refused, and the past payment can be voided like any other.
    await expect(enrollments.recordPastPayment(request, pastClientId, pastEnrollmentId, { amount: 5, paymentDate: '2099-01-01', paymentMethod: 'cash' } as never))
      .rejects.toThrow('cannot be dated in the future');
    const voided = overTheWire(await dashboard.voidPayment(request, String(past.id), { reason: 'Duplicate' }));
    expect(voided.voidReason).toBe('Duplicate');
  });

  it('keeps an agreement and period on every payment that is not a past payment (database check)', async () => {
    await expect(prisma.cfPaymentRecord.create({
      data: {
        organizationId: request.adminUser!.organizationId, enrollmentId, amount: 10, paymentDate: new Date(), paymentMethod: 'cash', source: 'manual',
      },
    })).rejects.toThrow(/CfPaymentRecord_agreement_or_historical_check/);
  });
});
