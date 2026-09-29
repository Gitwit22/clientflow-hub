import type { PrismaService } from '../../prisma/prisma.service';
import { BillingDashboardService } from './billing-dashboard.service';

const TZ = 'America/Detroit';

function agreement(overrides: Record<string, unknown>) {
  return {
    id: `agreement-${Math.random()}`,
    organizationId: 'org-1',
    status: 'active',
    endDate: null,
    customIntervalDays: null,
    defaultDueDay: 1,
    ...overrides,
  };
}

function payment(overrides: Record<string, unknown>) {
  return { organizationId: 'org-1', voidedAt: null, ...overrides };
}

function createFakePrisma(options: {
  agreements: any[];
  payments: any[];
  enrollments: any[];
  programs: any[];
  clients: any[];
  configs?: any[];
}) {
  return {
    cfEnrollmentBillingAgreement: { findMany: jest.fn().mockResolvedValue(options.agreements) },
    cfPaymentRecord: { findMany: jest.fn().mockResolvedValue(options.payments) },
    cfProgramEnrollment: { findMany: jest.fn().mockResolvedValue(options.enrollments) },
    cfProgram: { findMany: jest.fn().mockResolvedValue(options.programs) },
    cfClient: { findMany: jest.fn().mockResolvedValue(options.clients) },
    cfProgramBillingConfig: { findMany: jest.fn().mockResolvedValue(options.configs ?? []) },
  } as unknown as PrismaService;
}

describe('BillingDashboardService', () => {
  it('matches the worked example: 10 clients x $250/month => $2,500 monthly recurring revenue', async () => {
    const enrollments = Array.from({ length: 10 }, (_, i) => ({
      id: `enroll-${i}`,
      clientId: `client-${i}`,
      programId: 'program-1',
      isArchived: false,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    }));
    const agreements = enrollments.map((e) =>
      agreement({ enrollmentId: e.id, amount: 250, frequency: 'monthly', startDate: new Date('2026-01-01T05:00:00.000Z') }),
    );
    const clients = enrollments.map((e) => ({ id: e.clientId, businessName: e.clientId, isArchived: false }));
    const programs = [{ id: 'program-1', name: 'Business Development', organizationId: 'org-1' }];

    const prisma = createFakePrisma({ agreements, payments: [], enrollments, programs, clients });
    const service = new BillingDashboardService(prisma);

    const dashboard = await service.getOrgDashboard('org-1', TZ, 'month');
    expect(dashboard.revenue.activeRecurringRevenue).toBe(2500);
  });

  it("doesn't let an early payment applied to a future period make the prior period look overpaid", async () => {
    // Reference "now" for the dashboard's calendar-month bounds is fixed to September 2026.
    jest.useFakeTimers().setSystemTime(new Date('2026-09-15T12:00:00.000Z'));

    const enrollment = {
      id: 'enroll-1',
      clientId: 'client-1',
      programId: 'program-1',
      isArchived: false,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    };
    const theAgreement = agreement({
      enrollmentId: 'enroll-1',
      amount: 250,
      frequency: 'monthly',
      startDate: new Date('2026-01-01T05:00:00.000Z'),
    });
    // October's payment, made early on Sept 29, applied to October's obligation.
    const payments = [
      payment({
        enrollmentId: 'enroll-1',
        amount: 250,
        paymentDate: new Date('2026-09-29T12:00:00.000Z'),
        billingPeriodStart: new Date('2026-10-01T04:00:00.000Z'),
        billingPeriodEnd: new Date('2026-10-31T03:59:59.999Z'),
      }),
    ];
    const clients = [{ id: 'client-1', businessName: 'ABC Construction', isArchived: false }];
    const programs = [{ id: 'program-1', name: 'Business Development', organizationId: 'org-1' }];

    const prisma = createFakePrisma({
      agreements: [theAgreement],
      payments,
      enrollments: [enrollment],
      programs,
      clients,
    });
    const service = new BillingDashboardService(prisma);

    const dashboard = await service.getOrgDashboard('org-1', TZ, 'month');
    jest.useRealTimers();

    // Received (cash-basis) shows the Sept-arriving cash — a simple bank-statement view.
    expect(dashboard.revenue.received).toBe(250);
    // But Outstanding (obligation-based) still reflects Sept's obligation as unpaid, since the
    // only payment on file is applied to October, not September — this is the whole point of
    // attributing payments to billingPeriodStart/End instead of raw paymentDate.
    expect(dashboard.revenue.outstanding).toBeGreaterThan(0);
  });

  it('lists enrollments needing billing setup, excluding programs where billing is not required', async () => {
    const enrollments = [
      { id: 'enroll-required', clientId: 'client-1', programId: 'program-required', status: 'active', isArchived: false, startDate: null },
      { id: 'enroll-free', clientId: 'client-2', programId: 'program-free', status: 'active', isArchived: false, startDate: null },
      // Not in the program (yet, or any more): no billing setup is expected.
      { id: 'enroll-pending', clientId: 'client-1', programId: 'program-required', status: 'pending_review', isArchived: false, startDate: null },
      { id: 'enroll-withdrawn', clientId: 'client-1', programId: 'program-required', status: 'withdrawn', isArchived: false, startDate: null },
    ];
    const clients = [
      { id: 'client-1', businessName: 'Needs Setup Co', isArchived: false },
      { id: 'client-2', businessName: 'Free Program Co', isArchived: false },
    ];
    const programs = [
      { id: 'program-required', name: 'Paid Program', organizationId: 'org-1' },
      { id: 'program-free', name: 'Grant Assistance', organizationId: 'org-1' },
    ];
    const configs = [{ programId: 'program-free', billingRequired: false }];

    const prisma = createFakePrisma({ agreements: [], payments: [], enrollments, programs, clients, configs });
    const service = new BillingDashboardService(prisma);

    const dashboard = await service.getOrgDashboard('org-1', TZ, 'month');
    expect(dashboard.needsBillingSetup).toHaveLength(1);
    expect(dashboard.needsBillingSetup[0].clientName).toBe('Needs Setup Co');
  });

  it('marks an expected payment "partial" (not "paid") when the applied amount is less than the due amount', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-15T12:00:00.000Z'));

    const enrollment = {
      id: 'enroll-1',
      clientId: 'client-1',
      programId: 'program-1',
      isArchived: false,
      startDate: new Date('2026-01-01T00:00:00.000Z'),
    };
    const theAgreement = agreement({
      enrollmentId: 'enroll-1',
      amount: 250,
      frequency: 'monthly',
      startDate: new Date('2026-01-01T05:00:00.000Z'),
    });
    // Only $100 of September's $250 obligation has been paid so far.
    const payments = [
      payment({
        enrollmentId: 'enroll-1',
        amount: 100,
        paymentDate: new Date('2026-09-05T12:00:00.000Z'),
        billingPeriodStart: new Date('2026-09-01T04:00:00.000Z'),
        billingPeriodEnd: new Date('2026-09-30T03:59:59.999Z'),
      }),
    ];
    const clients = [{ id: 'client-1', businessName: 'ABC Construction', isArchived: false }];
    const programs = [{ id: 'program-1', name: 'Business Development', organizationId: 'org-1' }];

    const prisma = createFakePrisma({
      agreements: [theAgreement],
      payments,
      enrollments: [enrollment],
      programs,
      clients,
    });
    const service = new BillingDashboardService(prisma);

    const dashboard = await service.getOrgDashboard('org-1', TZ, 'month');
    jest.useRealTimers();

    const septemberRow = dashboard.expectedPayments.find((row) => row.enrollmentId === 'enroll-1');
    expect(septemberRow?.status).toBe('partial');
  });
});

describe('BillingDashboardService: revenue for reports', () => {
  it('totals received payments per program and counts paying clients', async () => {
    const inPeriod = new Date();
    const enrollments = [
      { id: 'e-1', clientId: 'c-1', programId: 'p-1', isArchived: false, startDate: null },
      { id: 'e-2', clientId: 'c-2', programId: 'p-1', isArchived: false, startDate: null },
      { id: 'e-3', clientId: 'c-3', programId: 'p-2', isArchived: false, startDate: null },
    ];
    const agreements = [
      agreement({ enrollmentId: 'e-1', amount: 25, frequency: 'monthly', startDate: new Date('2026-01-01T05:00:00.000Z') }),
      agreement({ enrollmentId: 'e-2', amount: 25, frequency: 'monthly', startDate: new Date('2026-01-01T05:00:00.000Z') }),
      agreement({ enrollmentId: 'e-3', amount: 100, frequency: 'monthly', status: 'ended', startDate: new Date('2026-01-01T05:00:00.000Z') }),
    ];
    const payments = [
      payment({ enrollmentId: 'e-1', amount: 25, paymentDate: inPeriod, billingPeriodStart: inPeriod, billingPeriodEnd: inPeriod }),
      payment({ enrollmentId: 'e-2', amount: 25, paymentDate: inPeriod, billingPeriodStart: inPeriod, billingPeriodEnd: inPeriod }),
      payment({ enrollmentId: 'e-3', amount: 100, paymentDate: inPeriod, billingPeriodStart: inPeriod, billingPeriodEnd: inPeriod }),
      // An archived enrollment's payment still counts toward its program.
      payment({ enrollmentId: 'e-archived', amount: 10, paymentDate: inPeriod, billingPeriodStart: inPeriod, billingPeriodEnd: inPeriod }),
      payment({ enrollmentId: 'e-1', amount: 999, paymentDate: new Date('2020-01-01T00:00:00.000Z'), billingPeriodStart: inPeriod, billingPeriodEnd: inPeriod }),
    ];
    const programs = [{ id: 'p-1', name: 'Inspired Detroit' }, { id: 'p-2', name: 'Grant' }];
    const clients = ['c-1', 'c-2', 'c-3'].map((id) => ({ id, businessName: id, isArchived: false }));
    const prisma = createFakePrisma({ agreements, payments, enrollments, programs, clients });
    (prisma.cfProgramEnrollment.findMany as jest.Mock)
      .mockResolvedValueOnce(enrollments)
      .mockResolvedValueOnce([{ id: 'e-archived', clientId: 'c-9', programId: 'p-2', isArchived: true }]);

    const dashboard = await new BillingDashboardService(prisma).getOrgDashboard('org-1', TZ, 'month');

    expect(dashboard.revenue.received).toBe(160);
    expect(dashboard.receivedByProgram).toEqual([
      { programId: 'p-2', programName: 'Grant', received: 110, payingClients: 2 },
      { programId: 'p-1', programName: 'Inspired Detroit', received: 50, payingClients: 2 },
    ]);
    expect(dashboard.payingClients).toBe(2);
  });
});
