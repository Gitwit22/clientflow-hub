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
});
