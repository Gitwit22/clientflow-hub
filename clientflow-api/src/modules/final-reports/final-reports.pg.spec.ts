import { PrismaClient } from '../../generated/clientflow';
import type { PrismaService } from '../../prisma/prisma.service';
import { ProgramDeliverablesService } from '../deliverables/program-deliverables.service';
import { FinalReportsService } from './final-reports.service';

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
      [...Array(3)].map(() => service.finalize(organizationId, { id: null, displayName: 'Jordan' }, draft.id, { outcome: 'Program Complete', confirm: true })),
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
});
