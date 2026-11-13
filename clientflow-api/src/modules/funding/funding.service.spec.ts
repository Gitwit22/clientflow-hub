import { Prisma } from '../../generated/clientflow';
import { inMemoryDb } from '../../invariants/in-memory-db';
import { BillingService } from '../billing/billing.service';
import { FundingService } from './funding.service';

/* eslint-disable @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-return */

const ORG = 'org-1';
const actor = { actorUserId: 'admin-1', actorDisplayName: 'Jordan Lee' };
const today = new Date().toISOString().slice(0, 10);

function setup() {
  const now = new Date('2026-11-01T00:00:00.000Z');
  const tables: Record<string, any[]> = {
    organization: [{ id: ORG, settings: { timezone: 'America/Detroit' } }],
    cfClient: [
      { id: 'client-1', organizationId: ORG, businessName: 'Rivers Bakery LLC', isDemo: false, isArchived: false },
      { id: 'client-x', organizationId: 'org-2', businessName: 'Other Org', isDemo: false, isArchived: false },
    ],
    cfProgram: [{ id: 'program-1', organizationId: ORG, name: 'IDI' }],
    cfProgramEnrollment: [
      { id: 'enr-1', organizationId: ORG, clientId: 'client-1', programId: 'program-1', isArchived: false, status: 'active' },
      { id: 'enr-old', organizationId: ORG, clientId: 'client-1', programId: 'program-1', isArchived: true, status: 'completed' },
    ],
    cfProgramContractTemplate: [
      { id: 'tpl-award', organizationId: ORG, programId: 'program-1', purpose: 'award', isActive: true, signatureRequired: true },
      { id: 'tpl-join', organizationId: ORG, programId: 'program-1', purpose: 'enrollment', isActive: true, signatureRequired: true },
    ],
    cfEnrollmentAward: [],
    cfAwardPayment: [],
    cfContract: [],
    cfDocument: [],
    cfActivityLog: [],
  };
  const db = inMemoryDb(tables, {
    cfEnrollmentAward: [['organizationId', 'idempotencyKey']],
    cfAwardPayment: [['organizationId', 'idempotencyKey']],
  }) as any;
  db.$queryRaw = jest.fn().mockResolvedValue([]);
  // Prisma fills these; the in-memory stand-in doesn't.
  for (const model of ['cfEnrollmentAward', 'cfAwardPayment']) {
    const create = db[model].create.bind(db[model]);
    db[model].create = ({ data }: { data: Record<string, unknown> }) => create({
      data: { createdAt: now, voidedAt: null, notes: '', currentAgreementId: null, agreementTemplateId: null, ...data },
    });
  }
  const service = new FundingService(db, new BillingService(db));
  return { db, tables, service };
}

const award = (overrides: Record<string, unknown> = {}) => ({
  title: 'Member Business Achievement Award',
  source: 'IDI Member Fund',
  amountAwarded: 5000,
  awardDate: '2026-11-12',
  ...overrides,
});

describe('FundingService', () => {
  it('records an award against one enrollment, in the organization timezone, scoped to the org', async () => {
    const { service } = setup();
    const created = await service.create(ORG, 'client-1', 'enr-1', award(), actor, null);
    expect(created).toEqual(expect.objectContaining({
      enrollmentId: 'enr-1', programId: 'program-1', amountAwarded: 5000, received: 0, outstanding: 5000,
      paymentState: 'unpaid', status: 'pending',
    }));
    // Midnight in Detroit, not UTC midnight (which is the previous evening there).
    expect(new Date(created.awardDate).toISOString()).toBe('2026-11-12T05:00:00.000Z');
    await expect(service.create('org-2', 'client-1', 'enr-1', award(), actor, null)).rejects.toThrow('Enrollment not found');
  });

  it('does not add a new award to an archived participation', async () => {
    const { service } = setup();
    await expect(service.create(ORG, 'client-1', 'enr-old', award(), actor, null)).rejects.toThrow('archived');
  });

  it('returns the same award for a retried create (idempotency key)', async () => {
    const { service, tables } = setup();
    const first = await service.create(ORG, 'client-1', 'enr-1', award(), actor, 'award-key-0001');
    const again = await service.create(ORG, 'client-1', 'enr-1', award(), actor, 'award-key-0001');
    expect(again.id).toBe(first.id);
    expect(tables.cfEnrollmentAward).toHaveLength(1);
  });

  it('only links an award agreement template of the same program', async () => {
    const { service } = setup();
    await expect(service.create(ORG, 'client-1', 'enr-1', award({ agreementTemplateId: 'tpl-join' }), actor, null))
      .rejects.toThrow('award agreement template');
    const ok = await service.create(ORG, 'client-1', 'enr-1', award({ agreementTemplateId: 'tpl-award' }), actor, null);
    expect(ok.agreementTemplateId).toBe('tpl-award');
  });

  it('awarded $5,000, paid $2,500: shows both and what is still owed', async () => {
    const { service, db } = setup();
    const created = await service.create(ORG, 'client-1', 'enr-1', award({ approve: true }), actor, null);
    const after = await service.recordPayment(ORG, created.id, { amount: 2500, paymentDate: today, paymentMethod: 'check' }, actor, 'pay-key-00001');
    expect(after).toEqual(expect.objectContaining({ amountAwarded: 5000, received: 2500, outstanding: 2500, paymentState: 'partially_paid' }));
    expect(after.payments).toHaveLength(1);
    // The balance check ran under the award's row lock.
    expect(db.$queryRaw).toHaveBeenCalled();
  });

  it('refuses payments before approval, beyond what is owed, or dated in the future', async () => {
    const { service } = setup();
    const pending = await service.create(ORG, 'client-1', 'enr-1', award(), actor, null);
    await expect(service.recordPayment(ORG, pending.id, { amount: 10, paymentDate: today, paymentMethod: 'ach' }, actor, null))
      .rejects.toThrow('Approve the award');
    await service.approve(ORG, pending.id, actor);
    await expect(service.recordPayment(ORG, pending.id, { amount: 5000.01, paymentDate: today, paymentMethod: 'ach' }, actor, null))
      .rejects.toThrow('still owed');
    await expect(service.recordPayment(ORG, pending.id, { amount: 10, paymentDate: '2099-01-01', paymentMethod: 'ach' }, actor, null))
      .rejects.toThrow('future');
  });

  it('records a retried payment once (idempotency key)', async () => {
    const { service, tables } = setup();
    const created = await service.create(ORG, 'client-1', 'enr-1', award({ approve: true }), actor, null);
    await service.recordPayment(ORG, created.id, { amount: 100, paymentDate: today, paymentMethod: 'cash' }, actor, 'pay-key-00002');
    await service.recordPayment(ORG, created.id, { amount: 100, paymentDate: today, paymentMethod: 'cash' }, actor, 'pay-key-00002');
    expect(tables.cfAwardPayment).toHaveLength(1);
  });

  it('voids a payment (kept in the ledger), which frees the amount again', async () => {
    const { service } = setup();
    const created = await service.create(ORG, 'client-1', 'enr-1', award({ approve: true, amountAwarded: 500 }), actor, null);
    const paid = await service.recordPayment(ORG, created.id, { amount: 500, paymentDate: today, paymentMethod: 'check' }, actor, null);
    const after = await service.voidPayment(ORG, paid.payments[0].id, 'Recorded on the wrong award.', actor);
    expect(after).toEqual(expect.objectContaining({ received: 0, outstanding: 500 }));
    expect(after.payments[0]).toEqual(expect.objectContaining({ voidReason: 'Recorded on the wrong award.' }));
    await expect(service.voidPayment(ORG, paid.payments[0].id, 'again', actor)).rejects.toThrow('already voided');
  });

  it('cancels only an award with nothing paid, and cancels its unsigned agreement', async () => {
    const { service, tables } = setup();
    const created = await service.create(ORG, 'client-1', 'enr-1', award({ approve: true }), actor, null);
    tables.cfContract.push({ id: 'agr-1', organizationId: ORG, awardId: created.id, status: 'SENT', secureTokenHash: 'h' });
    tables.cfContract.push({ id: 'agr-old', organizationId: ORG, awardId: created.id, status: 'COMPLETED', secureTokenHash: null });
    const cancelled = await service.cancel(ORG, created.id, 'Business closed.', actor);
    expect(cancelled).toEqual(expect.objectContaining({ status: 'cancelled', outstanding: 0, cancelReason: 'Business closed.' }));
    expect(tables.cfContract.find((row) => row.id === 'agr-1')).toEqual(expect.objectContaining({ status: 'CANCELLED', secureTokenHash: null }));
    // A signed agreement stays as history.
    expect(tables.cfContract.find((row) => row.id === 'agr-old')?.status).toBe('COMPLETED');

    const paid = await service.create(ORG, 'client-1', 'enr-1', award({ approve: true }), actor, null);
    await service.recordPayment(ORG, paid.id, { amount: 1, paymentDate: today, paymentMethod: 'cash' }, actor, null);
    await expect(service.cancel(ORG, paid.id, 'x', actor)).rejects.toThrow('Payments have been recorded');
  });

  it('replacing the agreement of a signed award sends it back for a new agreement', async () => {
    const { service, tables } = setup();
    const created = await service.create(ORG, 'client-1', 'enr-1', award({ approve: true }), actor, null);
    const row = tables.cfEnrollmentAward.find((candidate) => candidate.id === created.id);
    Object.assign(row, { status: 'agreement_signed', currentAgreementId: 'agr-signed' });
    await expect(service.update(ORG, created.id, { amountAwarded: 6000 }, actor)).rejects.toThrow('signed agreement');
    const updated = await service.update(ORG, created.id, { amountAwarded: 6000, replaceAgreement: true }, actor);
    expect(updated).toEqual(expect.objectContaining({ amountAwarded: 6000, status: 'approved', currentAgreementId: null }));
  });

  it('keeps an unpaid award of an archived participation in the follow-up list', async () => {
    const { service, tables } = setup();
    const open = await service.create(ORG, 'client-1', 'enr-1', award({ approve: true, amountAwarded: 1000 }), actor, null);
    await service.recordPayment(ORG, open.id, { amount: 400, paymentDate: today, paymentMethod: 'ach' }, actor, null);
    const paidInFull = await service.create(ORG, 'client-1', 'enr-1', award({ approve: true, amountAwarded: 200 }), actor, null);
    await service.recordPayment(ORG, paidInFull.id, { amount: 200, paymentDate: today, paymentMethod: 'ach' }, actor, null);
    // The participation is archived after the award was given.
    tables.cfProgramEnrollment.find((row) => row.id === 'enr-1').isArchived = true;

    const followUp = await service.outstanding(ORG);
    expect(followUp).toHaveLength(1);
    expect(followUp[0]).toEqual(expect.objectContaining({
      id: open.id, outstanding: 600, received: 400, businessName: 'Rivers Bakery LLC', programName: 'IDI', enrollmentArchived: true,
    }));
    // Payment can still be recorded after archiving.
    await expect(service.recordPayment(ORG, open.id, { amount: 600, paymentDate: today, paymentMethod: 'ach' }, actor, null))
      .resolves.toEqual(expect.objectContaining({ outstanding: 0, paymentState: 'paid' }));
    expect(await service.outstanding('org-2')).toEqual([]);
  });

  it('stores amounts as exact decimals', async () => {
    const { service, tables } = setup();
    const created = await service.create(ORG, 'client-1', 'enr-1', award({ approve: true, amountAwarded: 0.3 }), actor, null);
    await service.recordPayment(ORG, created.id, { amount: 0.1, paymentDate: today, paymentMethod: 'cash' }, actor, null);
    const after = await service.recordPayment(ORG, created.id, { amount: 0.2, paymentDate: today, paymentMethod: 'cash' }, actor, null);
    expect(after.outstanding).toBe(0);
    expect(tables.cfAwardPayment[0].amount).toBeInstanceOf(Prisma.Decimal);
  });
});
