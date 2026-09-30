import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from './billing.service';

const TZ = 'America/Detroit';

/** Minimal in-memory Prisma fake covering exactly what BillingService touches. */
function createFakePrisma() {
  const agreements: any[] = [];
  const payments: any[] = [];
  let agreementSeq = 0;
  let paymentSeq = 0;

  function matchesId(where: any, key: string, row: any) {
    const clause = where[key];
    if (clause === undefined) return true;
    if (typeof clause === 'object' && clause !== null && 'in' in clause) return clause.in.includes(row[key]);
    return row[key] === clause;
  }

  const cfEnrollmentBillingAgreement = {
    findFirst: jest.fn(async ({ where }: any) =>
      agreements.find(
        (row) =>
          matchesId(where, 'organizationId', row)
          && matchesId(where, 'enrollmentId', row)
          && (where.status === undefined || row.status === where.status),
      ) ?? null,
    ),
    findMany: jest.fn(async ({ where }: any) =>
      agreements.filter((row) => matchesId(where, 'organizationId', row) && matchesId(where, 'enrollmentId', row)),
    ),
    create: jest.fn(async ({ data }: any) => {
      agreementSeq += 1;
      const row = { id: `agreement-${agreementSeq}`, status: 'active', endDate: null, ...data };
      agreements.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = agreements.find((candidate) => candidate.id === where.id);
      Object.assign(row, data);
      return row;
    }),
  };

  const cfPaymentRecord = {
    findMany: jest.fn(async ({ where }: any) =>
      payments.filter(
        (row) =>
          matchesId(where, 'organizationId', row)
          && matchesId(where, 'enrollmentId', row)
          && (where.voidedAt === null ? row.voidedAt == null : true),
      ),
    ),
    findFirst: jest.fn(async ({ where }: any) =>
      payments.find((row) => row.organizationId === where.organizationId
        && (where.id === undefined || row.id === where.id)
        && (where.idempotencyKey === undefined || row.idempotencyKey === where.idempotencyKey)) ?? null,
    ),
    findFirstOrThrow: jest.fn(async ({ where }: any) => {
      const row = payments.find((candidate) => candidate.id === where.id && candidate.organizationId === where.organizationId);
      if (!row) throw new Error('No record found.');
      return row;
    }),
    create: jest.fn(async ({ data }: any) => {
      const duplicateBackfill =
        data.source === 'legacy_backfill'
        && payments.some(
          (row) =>
            row.enrollmentId === data.enrollmentId
            && row.source === 'legacy_backfill'
            && !row.voidedAt
            && row.billingPeriodStart.getTime() === data.billingPeriodStart.getTime()
            && row.billingPeriodEnd.getTime() === data.billingPeriodEnd.getTime(),
        );
      if (duplicateBackfill) {
        const error: Error & { code?: string } = new Error('Unique constraint failed');
        error.code = 'P2002';
        throw error;
      }
      paymentSeq += 1;
      const row = { id: `payment-${paymentSeq}`, voidedAt: null, ...data };
      payments.push(row);
      return row;
    }),
    update: jest.fn(async ({ where, data }: any) => {
      const row = payments.find((candidate) => candidate.id === where.id);
      Object.assign(row, data);
      return row;
    }),
    updateMany: jest.fn(async ({ where, data }: any) => {
      const rows = payments.filter((candidate) => candidate.id === where.id
        && candidate.organizationId === where.organizationId
        && (where.voidedAt === null ? candidate.voidedAt == null : true));
      rows.forEach((row) => Object.assign(row, data));
      return { count: rows.length };
    }),
    // skipDuplicates behaves like ON CONFLICT DO NOTHING against the backfill-period index.
    createMany: jest.fn(async ({ data, skipDuplicates }: any) => {
      let count = 0;
      for (const item of data) {
        try {
          await cfPaymentRecord.create({ data: item });
          count += 1;
        } catch (error) {
          if (!skipDuplicates || (error as { code?: string }).code !== 'P2002') throw error;
        }
      }
      return { count };
    }),
  };

  const organization = {
    findUnique: jest.fn().mockResolvedValue({ settings: { timezone: TZ } }),
  };
  const cfProgramEnrollment = { findFirst: jest.fn() };
  const cfProgram = { findFirst: jest.fn() };
  const cfProgramBillingConfig = {
    findFirst: jest.fn().mockResolvedValue(null),
    create: jest.fn(async ({ data }: any) => ({ id: 'config-1', ...data })),
    update: jest.fn(async ({ data }: any) => ({ id: 'config-1', ...data })),
  };

  const prisma = {
    organization,
    cfProgramEnrollment,
    cfProgram,
    cfProgramBillingConfig,
    cfEnrollmentBillingAgreement,
    cfPaymentRecord,
    $transaction: jest.fn(async (callback: any) => callback(prisma)),
  } as unknown as PrismaService;

  return { prisma, agreements, payments, cfProgram };
}

describe('BillingService', () => {
  describe('replaceAgreement', () => {
    it('creates the first agreement without ending anything', async () => {
      const { prisma, agreements } = createFakePrisma();
      const service = new BillingService(prisma);

      const created = await service.replaceAgreement({
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        amount: 250,
        frequency: 'monthly',
        startDate: new Date('2026-01-01T05:00:00.000Z'),
        defaultDueDay: 1,
        timezone: TZ,
        actorUserId: 'user-1',
        actorDisplayName: 'Jordan Staff',
      });

      expect(created.status).toBe('active');
      expect(agreements).toHaveLength(1);
    });

    it('ends the current agreement and inserts a new one, never mutating financial terms in place', async () => {
      const { prisma, agreements } = createFakePrisma();
      const service = new BillingService(prisma);
      const first = await service.replaceAgreement({
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        amount: 250,
        frequency: 'monthly',
        startDate: new Date('2026-01-01T05:00:00.000Z'),
        defaultDueDay: 1,
        timezone: TZ,
        actorUserId: 'user-1',
        actorDisplayName: 'Jordan Staff',
      });

      const second = await service.replaceAgreement({
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        amount: 300,
        frequency: 'monthly',
        startDate: new Date('2026-06-01T04:00:00.000Z'),
        defaultDueDay: 1,
        timezone: TZ,
        actorUserId: 'user-1',
        actorDisplayName: 'Jordan Staff',
      });

      expect(agreements).toHaveLength(2);
      const original = agreements.find((row) => row.id === first.id);
      expect(original.status).toBe('ended');
      expect(original.amount).toBe(250); // never rewritten in place
      expect(original.endDate).toBeInstanceOf(Date);
      expect(second.status).toBe('active');
      expect(second.amount).toBe(300);
    });
  });

  describe('recordPayment', () => {
    it('rejects a payment when there is no active agreement', async () => {
      const { prisma } = createFakePrisma();
      const service = new BillingService(prisma);

      await expect(
        service.recordPayment({
          organizationId: 'org-1',
          enrollmentId: 'enroll-1',
          amount: 250,
          paymentDate: new Date('2026-10-03T00:00:00.000Z'),
          paymentMethod: 'ach',
          billingPeriodStart: new Date('2026-10-01T04:00:00.000Z'),
          billingPeriodEnd: new Date('2026-10-31T03:59:59.999Z'),
          timezone: TZ,
          actorUserId: 'user-1',
          actorDisplayName: 'Jordan Staff',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('rejects a period that does not match the agreement schedule', async () => {
      const { prisma } = createFakePrisma();
      const service = new BillingService(prisma);
      await service.replaceAgreement({
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        amount: 250,
        frequency: 'monthly',
        startDate: new Date('2026-01-01T05:00:00.000Z'),
        defaultDueDay: 1,
        timezone: TZ,
        actorUserId: 'user-1',
        actorDisplayName: 'Jordan Staff',
      });

      await expect(
        service.recordPayment({
          organizationId: 'org-1',
          enrollmentId: 'enroll-1',
          amount: 250,
          paymentDate: new Date('2026-10-15T00:00:00.000Z'),
          paymentMethod: 'ach',
          // Neither Oct 10 nor Oct 12 is this monthly agreement's due date (Oct 1).
          billingPeriodStart: new Date('2026-10-10T04:00:00.000Z'),
          billingPeriodEnd: new Date('2026-10-12T04:00:00.000Z'),
          timezone: TZ,
          actorUserId: 'user-1',
          actorDisplayName: 'Jordan Staff',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('voidPayment', () => {
    it('marks a payment voided with audit fields and never deletes it', async () => {
      const { prisma, payments } = createFakePrisma();
      const service = new BillingService(prisma);
      payments.push({
        id: 'payment-1',
        organizationId: 'org-1',
        amount: 250,
        voidedAt: null,
      });

      const voided = await service.voidPayment('org-1', 'payment-1', 'Wrong client', 'user-2', 'Alex Admin');

      expect(voided.voidedAt).toBeInstanceOf(Date);
      expect(voided.voidedByUserId).toBe('user-2');
      expect(voided.voidedByDisplayName).toBe('Alex Admin');
      expect(voided.voidReason).toBe('Wrong client');
      expect(voided.amount).toBe(250); // amount is never touched
      expect(payments).toHaveLength(1); // never deleted
    });

    it('rejects voiding an already-voided payment', async () => {
      const { prisma, payments } = createFakePrisma();
      const service = new BillingService(prisma);
      payments.push({ id: 'payment-1', organizationId: 'org-1', amount: 250, voidedAt: new Date() });

      await expect(service.voidPayment('org-1', 'payment-1', 'again', null, 'Alex Admin')).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('rejects voiding a payment that does not exist', async () => {
      const { prisma } = createFakePrisma();
      const service = new BillingService(prisma);
      await expect(service.voidPayment('org-1', 'missing', 'x', null, 'Alex Admin')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('data integrity', () => {
    const agreementInput = {
      organizationId: 'org-1',
      enrollmentId: 'enroll-1',
      amount: 250,
      frequency: 'monthly' as const,
      startDate: new Date('2026-01-01T05:00:00.000Z'),
      defaultDueDay: 1,
      timezone: TZ,
      actorUserId: 'user-1',
      actorDisplayName: 'Jordan Staff',
    };
    const payment = {
      organizationId: 'org-1',
      enrollmentId: 'enroll-1',
      amount: 250,
      paymentDate: new Date('2026-02-03T00:00:00.000Z'),
      paymentMethod: 'ach' as const,
      billingPeriodStart: new Date('2026-02-01T05:00:00.000Z'),
      billingPeriodEnd: new Date('2026-03-01T04:59:59.999Z'),
      timezone: TZ,
      actorUserId: 'user-1',
      actorDisplayName: 'Jordan Staff',
      idempotencyKey: 'record-payment-0001',
    };

    it('a retried "record payment" (same key) returns the first record instead of recording twice', async () => {
      const { prisma, payments } = createFakePrisma();
      const service = new BillingService(prisma);
      await service.replaceAgreement(agreementInput);
      const periods = await service.listOpenPeriods('org-1', 'enroll-1', TZ, new Date('2026-02-15T00:00:00.000Z'));
      const february = periods[1];
      const input = { ...payment, billingPeriodStart: february.billingPeriodStart, billingPeriodEnd: february.billingPeriodEnd };

      const first = await service.recordPayment(input);
      const retry = await service.recordPayment(input);

      expect(retry.id).toBe(first.id);
      expect(payments.filter((row) => row.source === 'manual')).toHaveLength(1);
    });

    it('bringing an account current backfills only what a partly paid period still owes', async () => {
      const { prisma, payments } = createFakePrisma();
      const service = new BillingService(prisma);
      await service.replaceAgreement(agreementInput);
      const [january] = await service.listOpenPeriods('org-1', 'enroll-1', TZ, new Date('2026-01-15T00:00:00.000Z'));
      await service.recordPayment({
        ...payment,
        amount: 100,
        billingPeriodStart: january.billingPeriodStart,
        billingPeriodEnd: january.billingPeriodEnd,
      });

      const result = await service.confirmBackfill('org-1', 'enroll-1', TZ, {
        paidThroughDate: new Date('2026-01-31T00:00:00.000Z'),
      }, 'user-1', 'Jordan Staff');

      expect(result).toEqual({ created: 1, totalAmount: 150 });
      expect(payments.find((row) => row.source === 'legacy_backfill')?.amount).toBe(150);
    });

    it('two staff voiding the same payment at once record one void', async () => {
      const { prisma, payments } = createFakePrisma();
      const service = new BillingService(prisma);
      payments.push({ id: 'payment-1', organizationId: 'org-1', amount: 250, voidedAt: null });

      const outcomes = await Promise.allSettled([
        service.voidPayment('org-1', 'payment-1', 'Duplicate entry', 'user-1', 'Jordan Staff'),
        service.voidPayment('org-1', 'payment-1', 'Wrong amount', 'user-2', 'Alex Admin'),
      ]);

      expect(outcomes.filter((outcome) => outcome.status === 'fulfilled')).toHaveLength(1);
      expect(payments[0].voidReason).toBe('Duplicate entry');
    });
  });

  describe('getEnrollmentBillingSummary', () => {
    it('excludes voided payments from collected/outstanding, and only counts payments already due as applied', async () => {
      const { prisma, payments } = createFakePrisma();
      const service = new BillingService(prisma);
      const agreement = await service.replaceAgreement({
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        amount: 250,
        frequency: 'monthly',
        startDate: new Date('2026-01-01T05:00:00.000Z'),
        defaultDueDay: 1,
        timezone: TZ,
        actorUserId: 'user-1',
        actorDisplayName: 'Jordan Staff',
      });
      // A real Sept payment.
      payments.push({
        id: 'payment-sept',
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        billingAgreementId: agreement.id,
        amount: 250,
        billingPeriodStart: new Date('2026-09-01T04:00:00.000Z'),
        billingPeriodEnd: new Date('2026-09-30T03:59:59.999Z'),
        voidedAt: null,
      });
      // An October payment made early (Sept 29) but applied to October's obligation.
      payments.push({
        id: 'payment-oct-early',
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        billingAgreementId: agreement.id,
        amount: 250,
        billingPeriodStart: new Date('2026-10-01T04:00:00.000Z'),
        billingPeriodEnd: new Date('2026-10-31T03:59:59.999Z'),
        voidedAt: null,
      });
      // A voided duplicate that must not count anywhere.
      payments.push({
        id: 'payment-voided',
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        billingAgreementId: agreement.id,
        amount: 999,
        billingPeriodStart: new Date('2026-09-01T04:00:00.000Z'),
        billingPeriodEnd: new Date('2026-09-30T03:59:59.999Z'),
        voidedAt: new Date(),
      });

      // "Now" is Sept 29 — October's obligation isn't due yet, so its early payment shouldn't
      // count as "applied" toward outstanding even though the cash already exists.
      jest.useFakeTimers().setSystemTime(new Date('2026-09-29T12:00:00.000Z'));
      const summary = await service.getEnrollmentBillingSummary('org-1', 'enroll-1', TZ);
      jest.useRealTimers();

      expect(summary.collected).toBe(500); // sept + oct-early, voided excluded
      expect(summary.expected).toBe(9 * 250); // Jan..Sep occurrences due on/before "now"
      // applied = only the Sept payment, since Oct's obligation isn't due as of "now"
      expect(summary.outstanding).toBe(9 * 250 - 250);
    });
  });

  describe('backfill idempotency', () => {
    it('does not create duplicate historical payments when confirmed twice', async () => {
      const { prisma, payments } = createFakePrisma();
      const service = new BillingService(prisma);
      await service.replaceAgreement({
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        amount: 250,
        frequency: 'monthly',
        startDate: new Date('2026-01-01T05:00:00.000Z'),
        defaultDueDay: 1,
        timezone: TZ,
        actorUserId: 'user-1',
        actorDisplayName: 'Jordan Staff',
      });

      const selection = { paidThroughDate: new Date('2026-08-31T00:00:00.000Z') };
      const first = await service.confirmBackfill('org-1', 'enroll-1', TZ, selection, 'user-1', 'Jordan Staff');
      expect(first.created).toBe(8); // Jan..Aug
      expect(first.totalAmount).toBe(2000);

      const second = await service.confirmBackfill('org-1', 'enroll-1', TZ, selection, 'user-1', 'Jordan Staff');
      expect(second.created).toBe(0);
      expect(payments.filter((row) => row.source === 'legacy_backfill')).toHaveLength(8);
    });

    it('lets an admin confirm only an explicit subset of historical periods (Partial/Unknown mode)', async () => {
      const { prisma } = createFakePrisma();
      const service = new BillingService(prisma);
      await service.replaceAgreement({
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        amount: 250,
        frequency: 'monthly',
        startDate: new Date('2026-01-01T05:00:00.000Z'),
        defaultDueDay: 1,
        timezone: TZ,
        actorUserId: 'user-1',
        actorDisplayName: 'Jordan Staff',
      });

      const preview = await service.previewBackfill('org-1', 'enroll-1', TZ, {
        periods: [{ start: new Date('2026-03-01T05:00:00.000Z'), end: new Date('2026-04-01T03:59:59.999Z') }],
      });

      expect(preview.count).toBe(1);
      expect(preview.totalAmount).toBe(250);
    });
  });

  describe('voidPayment recomputes nextDueDate', () => {
    it('refreshes the still-active agreement\'s cached nextDueDate after a void', async () => {
      const { prisma, payments } = createFakePrisma();
      const service = new BillingService(prisma);
      const agreementRow = await service.replaceAgreement({
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        amount: 250,
        frequency: 'monthly',
        startDate: new Date('2026-01-01T05:00:00.000Z'),
        defaultDueDay: 1,
        timezone: TZ,
        actorUserId: 'user-1',
        actorDisplayName: 'Jordan Staff',
      });
      payments.push({
        id: 'payment-1',
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        billingAgreementId: agreementRow.id,
        amount: 250,
        voidedAt: null,
      });

      await service.voidPayment('org-1', 'payment-1', 'Wrong client', 'user-2', 'Alex Admin');

      const updatedAgreement = await service.getActiveAgreement('org-1', 'enroll-1');
      expect(updatedAgreement?.nextDueDate).toBeInstanceOf(Date);
    });

    it('does not touch an agreement that has already been replaced', async () => {
      const { prisma, payments } = createFakePrisma();
      const service = new BillingService(prisma);
      const first = await service.replaceAgreement({
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        amount: 250,
        frequency: 'monthly',
        startDate: new Date('2026-01-01T05:00:00.000Z'),
        defaultDueDay: 1,
        timezone: TZ,
        actorUserId: 'user-1',
        actorDisplayName: 'Jordan Staff',
      });
      await service.replaceAgreement({
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        amount: 300,
        frequency: 'monthly',
        startDate: new Date('2026-06-01T04:00:00.000Z'),
        defaultDueDay: 1,
        timezone: TZ,
        actorUserId: 'user-1',
        actorDisplayName: 'Jordan Staff',
      });
      payments.push({
        id: 'payment-1',
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        billingAgreementId: first.id, // belongs to the now-ended agreement
        amount: 250,
        voidedAt: null,
      });

      await expect(
        service.voidPayment('org-1', 'payment-1', 'Wrong client', 'user-2', 'Alex Admin'),
      ).resolves.toBeDefined();
      // No error thrown — the update-guard (status: 'active') simply finds nothing to refresh.
    });
  });

  describe('listOpenPeriods prepayment support', () => {
    it('includes the next upcoming (not-yet-due) period by default so prepayment is possible', async () => {
      const { prisma } = createFakePrisma();
      const service = new BillingService(prisma);
      jest.useFakeTimers().setSystemTime(new Date('2026-03-15T12:00:00.000Z'));
      await service.replaceAgreement({
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        amount: 250,
        frequency: 'monthly',
        startDate: new Date('2026-01-01T05:00:00.000Z'),
        defaultDueDay: 1,
        timezone: TZ,
        actorUserId: 'user-1',
        actorDisplayName: 'Jordan Staff',
      });

      const periods = await service.listOpenPeriods('org-1', 'enroll-1', TZ);
      jest.useRealTimers();

      // As of Mar 15: Jan/Feb/Mar are already due, and Apr is included too (the next upcoming one).
      expect(periods).toHaveLength(4);
      expect(periods[3].status).toBe('due');
    });

    it('an explicit throughDate is not extended (used by legacy backfill review)', async () => {
      const { prisma } = createFakePrisma();
      const service = new BillingService(prisma);
      await service.replaceAgreement({
        organizationId: 'org-1',
        enrollmentId: 'enroll-1',
        amount: 250,
        frequency: 'monthly',
        startDate: new Date('2026-01-01T05:00:00.000Z'),
        defaultDueDay: 1,
        timezone: TZ,
        actorUserId: 'user-1',
        actorDisplayName: 'Jordan Staff',
      });

      const periods = await service.listOpenPeriods(
        'org-1',
        'enroll-1',
        TZ,
        new Date('2026-03-15T00:00:00.000Z'),
      );
      expect(periods).toHaveLength(3); // Jan/Feb/Mar only — no lookahead into April
    });
  });

  describe('requireProgramForOrg', () => {
    it('throws when the program does not belong to the organization', async () => {
      const { prisma, cfProgram } = createFakePrisma();
      cfProgram.findFirst.mockResolvedValue(null);
      const service = new BillingService(prisma);

      await expect(service.requireProgramForOrg('org-1', 'program-from-another-org')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('resolves the program when it belongs to the organization', async () => {
      const { prisma, cfProgram } = createFakePrisma();
      cfProgram.findFirst.mockResolvedValue({ id: 'program-1', organizationId: 'org-1' });
      const service = new BillingService(prisma);

      await expect(service.requireProgramForOrg('org-1', 'program-1')).resolves.toEqual(
        expect.objectContaining({ id: 'program-1' }),
      );
    });
  });
});
