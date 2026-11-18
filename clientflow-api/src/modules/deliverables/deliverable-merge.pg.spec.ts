import { PrismaClient } from '../../generated/clientflow';
import type { PrismaService } from '../../prisma/prisma.service';
import { ProgramDeliverablesService } from './program-deliverables.service';

/** Merging one deliverable into another, against a real, migrated Postgres. Set CLIENTFLOW_PG_TEST_URL to run it. */
const url = process.env.CLIENTFLOW_PG_TEST_URL;
const describePg = url ? describe : describe.skip;

describePg('merging a deliverable into another (Postgres)', () => {
  let prisma: PrismaClient;
  let service: ProgramDeliverablesService;
  let organizationId: string;
  let programId: string;
  let memberFundId: string;
  let giveawayId: string;

  /** One client's month with both deliverables, like production's IDI checklists. */
  async function month(label: string, start: string, memberFund: { status: string; notes?: string; outcome?: string }, giveaway: { status: string; notes?: string } | null) {
    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const client = await prisma.cfClient.create({
      data: { organizationId, businessName: `Member ${stamp}`, primaryContactName: 'Pat', email: `m-${stamp}@x.test`, phone: '', assignedStaff: '', intake: {} },
    });
    const enrollment = await prisma.cfProgramEnrollment.create({ data: { organizationId, clientId: client.id, programId, status: 'active' } });
    const cycle = await prisma.cfEnrollmentDeliverableCycle.create({
      data: { organizationId, enrollmentId: enrollment.id, periodStart: new Date(start), periodEnd: new Date(new Date(start).getTime() + 27 * 86_400_000), label },
    });
    const item = await prisma.cfEnrollmentDeliverable.create({
      data: { organizationId, cycleId: cycle.id, enrollmentId: enrollment.id, programDeliverableTemplateId: memberFundId, titleSnapshot: 'IDI Member Fund Opportunities', status: memberFund.status as never, notes: memberFund.notes ?? null, outcome: memberFund.outcome ?? null },
    });
    const target = giveaway
      ? await prisma.cfEnrollmentDeliverable.create({
          data: { organizationId, cycleId: cycle.id, enrollmentId: enrollment.id, programDeliverableTemplateId: giveawayId, titleSnapshot: 'LIVE Grant Giveaway', status: giveaway.status as never, notes: giveaway.notes ?? null },
        })
      : null;
    return { item, target };
  }

  beforeAll(async () => {
    prisma = new PrismaClient({ datasources: { db: { url } } });
    service = new ProgramDeliverablesService(prisma as unknown as PrismaService);
    const stamp = Date.now();
    organizationId = (await prisma.organization.create({ data: { name: 'Merge', slug: `merge-${stamp}` } })).id;
    programId = (await prisma.cfProgram.create({
      data: { organizationId, name: 'IDI', description: '', defaultFormTemplateId: '', defaultMonitoringFrequency: '', defaultContractTemplateId: '' },
    })).id;
    memberFundId = (await service.createTemplate(organizationId, programId, { title: 'IDI Member Fund Opportunities' })).id;
    giveawayId = (await service.createTemplate(organizationId, programId, { title: 'LIVE Grant Giveaway' })).id;
  });
  afterAll(async () => prisma?.$disconnect());

  it('moves notes onto the same month\'s giveaway item, closes open items, turns the deliverable off, and is safe to repeat', async () => {
    const inProgress = await month('October 2026', '2026-10-01', { status: 'IN_PROGRESS', notes: 'Shared fund info' }, { status: 'IN_PROGRESS', notes: 'Attended' });
    const notStarted = await month('October 2026', '2026-10-01', { status: 'NOT_STARTED' }, { status: 'NOT_STARTED' });
    const alreadyNa = await month('November 2026', '2026-11-01', { status: 'NOT_APPLICABLE', notes: 'Fund not active' }, { status: 'COMPLETED', notes: 'Won' });
    const noGiveaway = await month('September 2026', '2026-09-01', { status: 'COMPLETED', outcome: 'Applied' }, null);

    const preview = await service.mergeTemplates(organizationId, programId, memberFundId, giveawayId, false);
    expect(preview).toEqual(expect.objectContaining({ applied: false, items: 4, notesMoved: 2, notesKeptInPlace: 1, closed: 2, alreadyMerged: 0, turnedOff: true }));
    expect((await prisma.cfEnrollmentDeliverable.findUniqueOrThrow({ where: { id: inProgress.item.id } })).status).toBe('IN_PROGRESS');

    const applied = await service.mergeTemplates(organizationId, programId, memberFundId, giveawayId, true);
    expect(applied).toEqual(expect.objectContaining({ applied: true, notesMoved: 2, closed: 2 }));

    const read = (id: string) => prisma.cfEnrollmentDeliverable.findUniqueOrThrow({ where: { id } });
    expect((await read(inProgress.target!.id)).notes).toBe('Attended\n\nFrom “IDI Member Fund Opportunities”: Shared fund info');
    expect((await read(inProgress.item.id)).status).toBe('NOT_APPLICABLE');
    expect((await read(inProgress.item.id)).notes).toBe('Shared fund info\n\nMerged into “LIVE Grant Giveaway”.');
    expect((await read(notStarted.item.id)).status).toBe('NOT_APPLICABLE');
    expect((await read(notStarted.target!.id)).notes).toBeNull();
    expect((await read(alreadyNa.target!.id)).notes).toBe('Won\n\nFrom “IDI Member Fund Opportunities”: Fund not active');
    // A finished item keeps its status; with no giveaway item that month its notes stay on it.
    expect((await read(noGiveaway.item.id))).toEqual(expect.objectContaining({ status: 'COMPLETED', outcome: 'Applied' }));
    // The giveaway items' own statuses are untouched.
    expect((await read(alreadyNa.target!.id)).status).toBe('COMPLETED');
    expect((await prisma.cfProgramDeliverableTemplate.findUniqueOrThrow({ where: { id: memberFundId } })).active).toBe(false);

    const again = await service.mergeTemplates(organizationId, programId, memberFundId, giveawayId, true);
    expect(again).toEqual(expect.objectContaining({ notesMoved: 0, closed: 0, alreadyMerged: 4, turnedOff: false }));
    expect((await read(inProgress.target!.id)).notes).toBe('Attended\n\nFrom “IDI Member Fund Opportunities”: Shared fund info');
  });

  it('refuses merging a deliverable into itself, into one that is off, or across programs', async () => {
    await expect(service.mergeTemplates(organizationId, programId, giveawayId, giveawayId, false)).rejects.toThrow('different deliverable');
    await expect(service.mergeTemplates(organizationId, programId, giveawayId, memberFundId, false)).rejects.toThrow('is turned off');
    const other = await prisma.cfProgram.create({
      data: { organizationId, name: 'Other', description: '', defaultFormTemplateId: '', defaultMonitoringFrequency: '', defaultContractTemplateId: '' },
    });
    await expect(service.mergeTemplates(organizationId, other.id, memberFundId, giveawayId, false)).rejects.toThrow('not found in this program');
  });
});
