import { PrismaClient } from '../../generated/clientflow';
import type { PrismaService } from '../../prisma/prisma.service';
import { BillingService } from '../billing/billing.service';
import { FundingService } from './funding.service';

/** Funding awards against a real, migrated Postgres. Set CLIENTFLOW_PG_TEST_URL to run it. */
const url = process.env.CLIENTFLOW_PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('funding awards (Postgres)', () => {
  let prisma: PrismaClient;
  let service: FundingService;
  let organizationId: string;
  let clientId: string;
  let enrollmentId: string;
  const actor = { actorUserId: null, actorDisplayName: 'Jordan' };
  const today = new Date().toISOString().slice(0, 10);

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const db = prisma as unknown as PrismaService;
    service = new FundingService(db, new BillingService(db));
    const stamp = Date.now();
    organizationId = (await prisma.organization.create({ data: { name: 'Funding', slug: `funding-${stamp}` } })).id;
    const program = await prisma.cfProgram.create({
      data: { organizationId, name: 'IDI', description: '', defaultFormTemplateId: '', defaultMonitoringFrequency: '', defaultContractTemplateId: '' },
    });
    clientId = (await prisma.cfClient.create({
      data: { organizationId, businessName: 'Rivers Bakery', primaryContactName: 'Pat', email: `p-${stamp}@x.test`, phone: '', assignedStaff: '', intake: {} },
    })).id;
    enrollmentId = (await prisma.cfProgramEnrollment.create({ data: { organizationId, clientId, programId: program.id, status: 'active' } })).id;
  });
  afterAll(async () => prisma?.$disconnect());

  const newAward = (amountAwarded: number) =>
    service.create(organizationId, clientId, enrollmentId, {
      title: 'Member Award', source: 'IDI Member Fund', amountAwarded, awardDate: today, approve: true,
    }, actor, null);

  it('never lets simultaneous payments take an award above what was awarded', async () => {
    const award = await newAward(1000);
    // Five staff record $300 at the same moment: only three fit under $1,000.
    const results = await Promise.allSettled(
      [...Array(5)].map(() => service.recordPayment(organizationId, award.id, { amount: 300, paymentDate: today, paymentMethod: 'check' }, actor, null)),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(3);
    const after = await service.get(organizationId, award.id);
    expect(after).toEqual(expect.objectContaining({ amountAwarded: 1000, received: 900, outstanding: 100 }));
  });

  it('records a payment once when the same request arrives twice at the same moment', async () => {
    const award = await newAward(500);
    const key = `pay-${Date.now()}-same`;
    await Promise.allSettled(
      [...Array(3)].map(() => service.recordPayment(organizationId, award.id, { amount: 100, paymentDate: today, paymentMethod: 'cash' }, actor, key)),
    );
    expect(await prisma.cfAwardPayment.count({ where: { organizationId, idempotencyKey: key } })).toBe(1);
  });

  it('cannot cancel an award while a payment is being recorded on it', async () => {
    const award = await newAward(400);
    const [payment, cancel] = await Promise.allSettled([
      service.recordPayment(organizationId, award.id, { amount: 400, paymentDate: today, paymentMethod: 'ach' }, actor, null),
      service.cancel(organizationId, award.id, 'Changed our minds', actor),
    ]);
    const final = await service.get(organizationId, award.id);
    // Whichever ran first, the award is never both cancelled and paid.
    expect(final.status === 'cancelled' && final.received > 0).toBe(false);
    expect([payment.status, cancel.status]).toContain('fulfilled');
  });

  it('enforces positive amounts in the database itself', async () => {
    const award = await newAward(100);
    await expect(prisma.cfAwardPayment.create({
      data: {
        organizationId, awardId: award.id, enrollmentId, clientId, amount: -5, paymentDate: new Date(),
        paymentMethod: 'cash', recordedByDisplayName: 'x',
      },
    })).rejects.toThrow();
  });
});
