import { PrismaClient } from '../../generated/clientflow';
import type { PrismaService } from '../../prisma/prisma.service';
import { ProgramDeliverablesService } from '../deliverables/program-deliverables.service';
import { BillingService } from '../billing/billing.service';
import { FundingService } from '../funding/funding.service';
import { FinalReportsService, type FinalReportSnapshot } from './final-reports.service';

/** Final reports against a real, migrated Postgres. Set CLIENTFLOW_PG_TEST_URL to run it. */
const url = process.env.CLIENTFLOW_PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('final reports (Postgres)', () => {
  let prisma: PrismaClient;
  let service: FinalReportsService;
  let organizationId: string;
  let clientId: string;
  let enrollmentId: string;
  let otherEnrollmentId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    const db = prisma as unknown as PrismaService;
    const deliverables = new ProgramDeliverablesService(db);
    service = new FinalReportsService(db, deliverables);
    const stamp = Date.now();
    organizationId = (await prisma.organization.create({ data: { name: 'Reports', slug: `reports-${stamp}` } })).id;
    const program = (name: string) => prisma.cfProgram.create({
      data: { organizationId, name, description: '', defaultFormTemplateId: '', defaultMonitoringFrequency: '', defaultContractTemplateId: '' },
    });
    const [idi, coaching] = [await program('IDI'), await program('Coaching')];
    clientId = (await prisma.cfClient.create({
      data: { organizationId, businessName: 'Moonlight', primaryContactName: 'Pat', email: `p-${stamp}@x.test`, phone: '', assignedStaff: '', intake: { budgetNeed: '$25,000' } },
    })).id;
    enrollmentId = (await prisma.cfProgramEnrollment.create({ data: { organizationId, clientId, programId: idi.id, status: 'active' } })).id;
    otherEnrollmentId = (await prisma.cfProgramEnrollment.create({ data: { organizationId, clientId, programId: coaching.id, status: 'active' } })).id;
    await deliverables.createTemplate(organizationId, idi.id, { title: 'Grant Giveaway' });
    await deliverables.getCurrent(organizationId, enrollmentId);
  });
  afterAll(async () => prisma?.$disconnect());

  it('finalizes once under simultaneous requests, archiving only that program', async () => {
    const draft = await service.createDraft(organizationId, clientId, { enrollmentId });
    const results = await Promise.allSettled(
      // The October checklist item is unfinished, so closing needs a recorded reason.
      [...Array(3)].map(() => service.finalize(organizationId, { id: null, displayName: 'Jordan' }, draft.id, {
        outcome: 'Program Complete', confirm: true, closureNote: 'Grant Giveaway handled outside the checklist.',
      })),
    );
    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);

    const report = await prisma.cfFinalReport.findUniqueOrThrow({ where: { id: draft.id } });
    expect(report.status).toBe('FINALIZED');
    expect(report.snapshot).toEqual(expect.objectContaining({ programName: 'IDI', statedFundingNeed: '$25,000', termsAmount: null }));
    expect(await prisma.cfEnrollmentStatusHistory.count({ where: { enrollmentId } })).toBe(1);
    expect(await prisma.cfProgramEnrollment.findUniqueOrThrow({ where: { id: enrollmentId } }))
      .toEqual(expect.objectContaining({ status: 'completed', isArchived: true }));
    expect(await prisma.cfProgramEnrollment.findUniqueOrThrow({ where: { id: otherEnrollmentId } }))
      .toEqual(expect.objectContaining({ status: 'active', isArchived: false }));
    expect((await prisma.cfClient.findUniqueOrThrow({ where: { id: clientId } })).isArchived).toBe(false);
  });

  it('a payment racing a finalize never leaves the report disagreeing with itself', async () => {
    const db = prisma as unknown as PrismaService;
    const funding = new FundingService(db, new BillingService(db));
    const program = await prisma.cfProgram.create({
      data: { organizationId, name: 'Race', description: '', defaultFormTemplateId: '', defaultMonitoringFrequency: '', defaultContractTemplateId: '' },
    });
    const raceEnrollment = (await prisma.cfProgramEnrollment.create({ data: { organizationId, clientId, programId: program.id, status: 'active' } })).id;
    const actor = { actorUserId: null, actorDisplayName: 'Jordan' };
    const today = new Date().toISOString().slice(0, 10);
    const award = await funding.create(organizationId, clientId, raceEnrollment, {
      title: 'Race Award', source: 'Fund', amountAwarded: 300, awardDate: today, approve: true,
    }, actor, null);
    const review = await service.closureReview(organizationId, raceEnrollment);
    expect(review.items.map((item) => item.kind)).toEqual(['award']);
    const draft = await service.createDraft(organizationId, clientId, { enrollmentId: raceEnrollment });

    const [finalized] = await Promise.allSettled([
      service.finalize(organizationId, { id: null, displayName: 'Jordan' }, draft.id, {
        outcome: 'Program Complete', confirm: true, closureNote: 'Paying the rest after closing.', reviewHash: review.reviewHash,
      }),
      funding.recordPayment(organizationId, award.id, { amount: 300, paymentDate: today, paymentMethod: 'check' }, actor, null),
    ]);

    const report = await prisma.cfFinalReport.findUniqueOrThrow({ where: { id: draft.id } });
    if (finalized.status === 'fulfilled') {
      // Finalized first: what it recorded as open matches the award figures it recorded.
      const snapshot = report.snapshot as unknown as FinalReportSnapshot;
      const listedAsOpen = snapshot.closureReview!.items.some((item) => item.kind === 'award');
      expect(listedAsOpen).toBe(snapshot.awards![0].outstanding > 0);
    } else {
      // The payment changed what was open: finalizing is refused so staff review again.
      expect(String((finalized.reason as Error).message)).toMatch(/changed since you reviewed|could not serialize|P2034/i);
      expect(report.status).toBe('DRAFT');
    }
    // Either way the payment is recorded exactly once.
    expect(await prisma.cfAwardPayment.count({ where: { awardId: award.id, voidedAt: null } })).toBe(1);
  });
});
