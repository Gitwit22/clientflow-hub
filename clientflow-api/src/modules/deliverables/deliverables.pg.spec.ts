import { PrismaClient } from '../../generated/clientflow';
import type { PrismaService } from '../../prisma/prisma.service';
import { ProgramDeliverablesService } from './program-deliverables.service';

/** Program deliverables against a real, migrated Postgres. Set CLIENTFLOW_PG_TEST_URL to run it. */
const url = process.env.CLIENTFLOW_PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('program deliverables (Postgres)', () => {
  let prisma: PrismaClient;
  let service: ProgramDeliverablesService;
  let organizationId: string;
  let enrollmentId: string;

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    service = new ProgramDeliverablesService(prisma as unknown as PrismaService);
    const stamp = Date.now();
    const org = await prisma.organization.create({ data: { name: 'Deliverables', slug: `deliverables-${stamp}` } });
    organizationId = org.id;
    const program = await prisma.cfProgram.create({
      data: {
        organizationId,
        name: `Program ${stamp}`,
        description: '',
        defaultFormTemplateId: '',
        defaultMonitoringFrequency: '',
        defaultContractTemplateId: '',
      },
    });
    const client = await prisma.cfClient.create({
      data: {
        organizationId,
        businessName: 'Moonlight Minerals',
        primaryContactName: 'Pat',
        email: `pat-${stamp}@x.test`,
        phone: '',
        assignedStaff: '',
        intake: {},
      },
    });
    const enrollment = await prisma.cfProgramEnrollment.create({
      data: { organizationId, clientId: client.id, programId: program.id, status: 'active' },
    });
    enrollmentId = enrollment.id;
    for (const title of ['Coaching Session', 'Financial Review', 'Business Plan Update']) {
      await service.createTemplate(organizationId, program.id, { title });
    }
  });
  afterAll(async () => prisma?.$disconnect());

  it('creates exactly one cycle and one row per deliverable under concurrent loads', async () => {
    const now = new Date('2026-10-15T12:00:00.000Z');
    const results = await Promise.all([...Array(8)].map(() => service.getCurrent(organizationId, enrollmentId, now)));

    expect(new Set(results.map((view) => view.cycle?.id)).size).toBe(1);
    expect(await prisma.cfEnrollmentDeliverableCycle.count({ where: { enrollmentId } })).toBe(1);
    expect(await prisma.cfEnrollmentDeliverable.count({ where: { enrollmentId } })).toBe(3);
  });

  it('the database itself refuses a duplicate cycle or a duplicate deliverable', async () => {
    const cycle = await prisma.cfEnrollmentDeliverableCycle.findFirstOrThrow({ where: { enrollmentId } });
    const item = await prisma.cfEnrollmentDeliverable.findFirstOrThrow({ where: { cycleId: cycle.id } });

    await expect(
      prisma.cfEnrollmentDeliverableCycle.create({
        data: { organizationId, enrollmentId, cadence: 'MONTHLY', periodStart: cycle.periodStart, periodEnd: cycle.periodEnd, label: 'dup' },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(
      prisma.cfEnrollmentDeliverable.create({
        data: {
          organizationId,
          enrollmentId,
          cycleId: cycle.id,
          programDeliverableTemplateId: item.programDeliverableTemplateId,
          titleSnapshot: 'dup',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });

  it('swaps the next action in one transaction', async () => {
    const view = await service.getCurrent(organizationId, enrollmentId, new Date('2026-10-15T12:00:00.000Z'));
    const [first, second] = view.items;
    const actor = { id: null, displayName: 'Test' };
    await service.setNextAction(organizationId, actor, enrollmentId, first.id);
    await service.setNextAction(organizationId, actor, enrollmentId, second.id);
    const marked = await prisma.cfEnrollmentDeliverable.findMany({ where: { cycleId: view.cycle!.id, isNextAction: true } });
    expect(marked.map((row) => row.id)).toEqual([second.id]);
  });
});
