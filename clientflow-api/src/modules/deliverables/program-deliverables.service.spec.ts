import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { inMemoryDb } from '../../invariants/in-memory-db';
import { DELIVERABLE_ACTIVITY, ProgramDeliverablesService } from './program-deliverables.service';

type Row = Record<string, unknown>;

const ORG = 'org-a';
const OTHER_ORG = 'org-b';
const staff = { id: 'admin-1', displayName: 'Jordan Lee' };
const OCT = new Date('2026-10-15T15:00:00.000Z');
const NOV = new Date('2026-11-03T15:00:00.000Z');

function setup() {
  const rows: Record<string, Row[]> = {
    organization: [
      { id: ORG, settings: { timezone: 'America/Detroit' } },
      { id: OTHER_ORG, settings: {} },
    ],
    cfProgram: [
      { id: 'p-idi', organizationId: ORG, name: 'Program A' },
      { id: 'p-coach', organizationId: ORG, name: 'Program B' },
      { id: 'p-empty', organizationId: ORG, name: 'Program C' },
      { id: 'p-foreign', organizationId: OTHER_ORG, name: 'Theirs' },
    ],
    cfProgramEnrollment: [
      { id: 'e-idi', organizationId: ORG, clientId: 'c1', programId: 'p-idi', status: 'active', isArchived: false, isDemo: false },
      { id: 'e-coach', organizationId: ORG, clientId: 'c1', programId: 'p-coach', status: 'active', isArchived: false, isDemo: false },
      { id: 'e-idi-2', organizationId: ORG, clientId: 'c4', programId: 'p-idi', status: 'active', isArchived: false, isDemo: false },
      { id: 'e-empty', organizationId: ORG, clientId: 'c2', programId: 'p-empty', status: 'active', isArchived: false, isDemo: false },
      { id: 'e-onboarding', organizationId: ORG, clientId: 'c3', programId: 'p-idi', status: 'onboarding', isArchived: false, isDemo: false },
      { id: 'e-foreign', organizationId: OTHER_ORG, clientId: 'cx', programId: 'p-foreign', status: 'active', isArchived: false, isDemo: false },
    ],
    cfProgramDeliverableTemplate: [
      template('t-giveaway', 'p-idi', 'Grant Giveaway', 0),
      template('t-event', 'p-idi', 'Networking Event', 1),
      template('t-grants', 'p-idi', 'Vetted Grant Opportunities', 2),
      template('t-retired', 'p-idi', 'Retired Item', 3, { active: false }),
      template('t-quarterly', 'p-idi', 'Progress Assessment', 4, { cadence: 'QUARTERLY' }),
      template('t-call', 'p-coach', 'Coaching Call', 0),
      template('t-review', 'p-coach', 'Financial Review', 1),
      template('t-foreign', 'p-foreign', 'Their Deliverable', 0, { organizationId: OTHER_ORG }),
    ],
    cfEnrollmentDeliverableCycle: [],
    cfProgramDeliverableSchedule: [],
    cfEnrollmentDeliverable: [],
    cfActivityLog: [],
  };
  const db = inMemoryDb(rows, {
    cfEnrollmentDeliverableCycle: [['enrollmentId', 'cadence', 'periodStart']],
    cfEnrollmentDeliverable: [['cycleId', 'programDeliverableTemplateId']],
    cfProgramDeliverableSchedule: [['templateId', 'periodStart']],
  });
  const service = new ProgramDeliverablesService(db as unknown as PrismaService);
  return { rows, service };
}

function template(id: string, programId: string, title: string, sortOrder: number, extra: Row = {}): Row {
  return {
    id,
    organizationId: ORG,
    programId,
    title,
    description: null,
    cadence: 'MONTHLY',
    active: true,
    programWideDate: false,
    sortOrder,
    createdAt: new Date('2026-09-01T00:00:00.000Z'),
    ...extra,
  };
}

describe('ProgramDeliverablesService: cycles', () => {
  it('gives an active enrollment its current month with the active monthly deliverables, in order', async () => {
    const { service } = setup();
    const view = await service.getCurrent(ORG, 'e-idi', OCT);

    expect(view.reason).toBeNull();
    expect(view.cycle).toEqual(expect.objectContaining({
      label: 'October 2026',
      status: 'OPEN',
      cadence: 'MONTHLY',
      // Month bounds in the organization's timezone (Detroit is UTC-4 in October).
      periodStart: new Date('2026-10-01T04:00:00.000Z'),
    }));
    // Inactive and non-monthly templates are not part of the month.
    expect(view.items.map((item) => item.titleSnapshot)).toEqual([
      'Grant Giveaway',
      'Networking Event',
      'Vetted Grant Opportunities',
    ]);
    expect(view.summary).toEqual({ total: 3, deliveredOrCompleted: 0, available: 0, notApplicable: 0, open: 3 });
  });

  it('is idempotent: repeated and simultaneous loads never duplicate the cycle or its deliverables', async () => {
    const { rows, service } = setup();
    await Promise.all([
      service.getCurrent(ORG, 'e-idi', OCT),
      service.getCurrent(ORG, 'e-idi', OCT),
      service.ensureCurrentCycle(ORG, 'e-idi', OCT),
    ]);
    await service.getCurrent(ORG, 'e-idi', OCT);

    expect(rows.cfEnrollmentDeliverableCycle).toHaveLength(1);
    expect(rows.cfEnrollmentDeliverable).toHaveLength(3);
    // Page loads write no activity.
    expect(rows.cfActivityLog).toHaveLength(0);
  });

  it('starts a new cycle each month and keeps the old one', async () => {
    const { rows, service } = setup();
    await service.getCurrent(ORG, 'e-idi', OCT);
    const november = await service.getCurrent(ORG, 'e-idi', NOV);

    expect(november.cycle?.label).toBe('November 2026');
    expect(rows.cfEnrollmentDeliverableCycle).toHaveLength(2);
    const history = await service.listHistory(ORG, 'e-idi');
    expect(history.map((cycle) => cycle.label)).toEqual(['November 2026', 'October 2026']);
  });

  it('never rewrites an existing cycle when the program changes; new cycles use the new configuration', async () => {
    const { rows, service } = setup();
    const october = await service.getCurrent(ORG, 'e-idi', OCT);

    await service.updateTemplate(ORG, 'p-idi', 't-giveaway', { title: 'LIVE Grant Giveaway' });
    await service.updateTemplate(ORG, 'p-idi', 't-event', { active: false });
    await service.createTemplate(ORG, 'p-idi', { title: 'B2B Opportunities' });

    const octoberAgain = await service.getCycle(ORG, 'e-idi', october.cycle!.id);
    expect(octoberAgain.items.map((item) => item.titleSnapshot)).toEqual([
      'Grant Giveaway',
      'Networking Event',
      'Vetted Grant Opportunities',
    ]);
    const november = await service.getCurrent(ORG, 'e-idi', NOV);
    expect(november.items.map((item) => item.titleSnapshot)).toEqual([
      'LIVE Grant Giveaway',
      'Vetted Grant Opportunities',
      'B2B Opportunities',
    ]);
    expect(rows.cfEnrollmentDeliverable).toHaveLength(6);
  });

  it('gives different programs their own deliverables', async () => {
    const { service } = setup();
    const idi = await service.getCurrent(ORG, 'e-idi', OCT);
    const coaching = await service.getCurrent(ORG, 'e-coach', OCT);
    expect(idi.items.map((item) => item.titleSnapshot)).toContain('Grant Giveaway');
    expect(coaching.items.map((item) => item.titleSnapshot)).toEqual(['Coaching Call', 'Financial Review']);
  });

  it('leaves an enrollment alone when its program has no deliverables', async () => {
    const { rows, service } = setup();
    const view = await service.getCurrent(ORG, 'e-empty', OCT);
    expect(view).toEqual(expect.objectContaining({ cycle: null, items: [], reason: 'no_deliverables_configured', nextAction: null }));
    expect(rows.cfEnrollmentDeliverableCycle).toHaveLength(0);
  });

  it('creates no cycle for an enrollment that is not active', async () => {
    const { rows, service } = setup();
    const view = await service.getCurrent(ORG, 'e-onboarding', OCT);
    expect(view.reason).toBe('enrollment_not_active');
    expect(rows.cfEnrollmentDeliverableCycle).toHaveLength(0);
  });
});

describe('ProgramDeliverablesService: tracking a deliverable', () => {
  async function october() {
    const context = setup();
    const view = await context.service.getCurrent(ORG, 'e-idi', OCT);
    const byTitle = (title: string) => view.items.find((item) => item.titleSnapshot === title)!;
    return { ...context, view, byTitle };
  }

  it('accepts a status without a date, and clears a date when asked', async () => {
    const { service, byTitle } = await october();
    const grants = await service.updateDeliverable(ORG, staff, 'e-idi', byTitle('Vetted Grant Opportunities').id, {
      status: 'DELIVERED',
      notes: 'Shared four opportunities',
    });
    expect(grants).toEqual(expect.objectContaining({ status: 'DELIVERED', notes: 'Shared four opportunities', completedAt: expect.any(Date) }));
    expect(grants.scheduledFor ?? null).toBeNull();

    const giveaway = await service.updateDeliverable(ORG, staff, 'e-idi', byTitle('Grant Giveaway').id, {
      status: 'SCHEDULED',
      scheduledFor: '2026-10-21',
    });
    expect(giveaway.scheduledFor).toEqual(new Date('2026-10-21'));
    const cleared = await service.updateDeliverable(ORG, staff, 'e-idi', byTitle('Grant Giveaway').id, { scheduledFor: null });
    expect(cleared.scheduledFor).toBeNull();
  });

  it('logs status changes and completions, not note edits', async () => {
    const { rows, service, byTitle } = await october();
    const id = byTitle('Networking Event').id;
    await service.updateDeliverable(ORG, staff, 'e-idi', id, { status: 'AVAILABLE' });
    await service.updateDeliverable(ORG, staff, 'e-idi', id, { notes: 'Held downtown' });
    await service.updateDeliverable(ORG, staff, 'e-idi', id, { status: 'COMPLETED' });

    expect(rows.cfActivityLog.map((row) => row.action)).toEqual([
      DELIVERABLE_ACTIVITY.statusChanged,
      DELIVERABLE_ACTIVITY.completed,
    ]);
    expect(rows.cfActivityLog[1]).toEqual(expect.objectContaining({
      organizationId: ORG,
      clientId: 'c1',
      enrollmentId: 'e-idi',
      actorUserId: 'admin-1',
      user: 'Jordan Lee',
      description: 'Networking Event (October 2026): Available → Completed.',
    }));
  });

  it('keeps one explicit next action per cycle and swaps it transactionally', async () => {
    const { rows, service, byTitle } = await october();
    await service.setNextAction(ORG, staff, 'e-idi', byTitle('Grant Giveaway').id);
    await service.setNextAction(ORG, staff, 'e-idi', byTitle('Networking Event').id);

    const marked = rows.cfEnrollmentDeliverable.filter((row) => row.isNextAction);
    expect(marked.map((row) => row.titleSnapshot)).toEqual(['Networking Event']);
    const view = await service.getCurrent(ORG, 'e-idi', OCT);
    expect(view.nextAction?.titleSnapshot).toBe('Networking Event');
    expect(rows.cfActivityLog.filter((row) => row.action === DELIVERABLE_ACTIVITY.nextActionSet)).toHaveLength(2);
  });

  it('drops a completed next action, then falls back to the nearest scheduled item, never an unscheduled one', async () => {
    const { service, byTitle } = await october();
    await service.setNextAction(ORG, staff, 'e-idi', byTitle('Networking Event').id);
    await service.updateDeliverable(ORG, staff, 'e-idi', byTitle('Networking Event').id, { status: 'COMPLETED' });

    let view = await service.getCurrent(ORG, 'e-idi', OCT);
    expect(view.items.find((item) => item.titleSnapshot === 'Networking Event')?.isNextAction).toBe(false);
    expect(view.nextAction).toBeNull(); // nothing scheduled: no arbitrary pick

    await service.updateDeliverable(ORG, staff, 'e-idi', byTitle('Grant Giveaway').id, { status: 'SCHEDULED', scheduledFor: '2026-10-21' });
    view = await service.getCurrent(ORG, 'e-idi', OCT);
    expect(view.nextAction?.titleSnapshot).toBe('Grant Giveaway');
  });

  it('refuses to make a resolved deliverable the next action', async () => {
    const { service, byTitle } = await october();
    await service.updateDeliverable(ORG, staff, 'e-idi', byTitle('Grant Giveaway').id, { status: 'NOT_APPLICABLE' });
    await expect(service.setNextAction(ORG, staff, 'e-idi', byTitle('Grant Giveaway').id)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('counts not applicable separately from delivered', async () => {
    const { service, byTitle } = await october();
    await service.updateDeliverable(ORG, staff, 'e-idi', byTitle('Grant Giveaway').id, { status: 'DELIVERED' });
    await service.updateDeliverable(ORG, staff, 'e-idi', byTitle('Networking Event').id, { status: 'COMPLETED' });
    await service.updateDeliverable(ORG, staff, 'e-idi', byTitle('Vetted Grant Opportunities').id, { status: 'NOT_APPLICABLE' });

    const view = await service.getCurrent(ORG, 'e-idi', OCT);
    expect(view.summary).toEqual({ total: 3, deliveredOrCompleted: 2, available: 0, notApplicable: 1, open: 0 });
  });

  it('makes a finalized cycle read-only', async () => {
    const { rows, service, view, byTitle } = await october();
    const finalized = await service.finalizeCycle(ORG, staff, 'e-idi', view.cycle!.id);
    expect(finalized).toEqual(expect.objectContaining({ status: 'FINALIZED', finalizedByDisplayName: 'Jordan Lee', finalizedAt: expect.any(Date) }));

    const id = byTitle('Grant Giveaway').id;
    await expect(service.updateDeliverable(ORG, staff, 'e-idi', id, { status: 'DELIVERED' })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.setNextAction(ORG, staff, 'e-idi', id)).rejects.toBeInstanceOf(ConflictException);
    await expect(service.finalizeCycle(ORG, staff, 'e-idi', view.cycle!.id)).rejects.toBeInstanceOf(ConflictException);
    expect(rows.cfActivityLog.filter((row) => row.action === DELIVERABLE_ACTIVITY.cycleFinalized)).toHaveLength(1);
  });
});

describe('ProgramDeliverablesService: program templates', () => {
  it('adds deliverables at the end and reorders them', async () => {
    const { service } = setup();
    const added = await service.createTemplate(ORG, 'p-coach', { title: '  Business Plan Update ', description: '' });
    expect(added).toEqual(expect.objectContaining({ title: 'Business Plan Update', description: null, cadence: 'MONTHLY', active: true, sortOrder: 2 }));

    const reordered = await service.reorderTemplates(ORG, 'p-coach', { orderedIds: [added.id, 't-review', 't-call'] });
    expect(reordered.map((row) => row.title)).toEqual(['Business Plan Update', 'Financial Review', 'Coaching Call']);
  });

  it('refuses a reorder that drops, repeats or adds a deliverable', async () => {
    const { service } = setup();
    for (const orderedIds of [['t-call'], ['t-call', 't-call'], ['t-call', 't-review', 't-giveaway']]) {
      await expect(service.reorderTemplates(ORG, 'p-coach', { orderedIds })).rejects.toBeInstanceOf(BadRequestException);
    }
  });

  it('refuses a blank title', async () => {
    const { service } = setup();
    await expect(service.createTemplate(ORG, 'p-coach', { title: '   ' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.updateTemplate(ORG, 'p-coach', 't-call', { title: ' ' })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ProgramDeliverablesService: tenant isolation', () => {
  it("never reads or changes another organization's programs, enrollments, cycles or deliverables", async () => {
    const { rows, service } = setup();
    const theirs = await service.getCurrent(OTHER_ORG, 'e-foreign', OCT);
    const theirItem = theirs.items[0];

    await expect(service.listTemplates(ORG, 'p-foreign')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createTemplate(ORG, 'p-foreign', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.updateTemplate(ORG, 'p-foreign', 't-foreign', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    // Their template id through one of our programs is just as unknown.
    await expect(service.updateTemplate(ORG, 'p-idi', 't-foreign', { title: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getCurrent(ORG, 'e-foreign', OCT)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listHistory(ORG, 'e-foreign')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getCycle(ORG, 'e-foreign', theirs.cycle!.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.getCycle(ORG, 'e-idi', theirs.cycle!.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.updateDeliverable(ORG, staff, 'e-idi', theirItem.id, { status: 'DELIVERED' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.setNextAction(ORG, staff, 'e-idi', theirItem.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.finalizeCycle(ORG, staff, 'e-idi', theirs.cycle!.id)).rejects.toBeInstanceOf(NotFoundException);

    expect(rows.cfEnrollmentDeliverable.find((row) => row.id === theirItem.id)).toEqual(expect.objectContaining({ status: 'NOT_STARTED', isNextAction: false }));
    expect(rows.cfProgramDeliverableTemplate.find((row) => row.id === 't-foreign')?.title).toBe('Their Deliverable');
  });
});

describe('ProgramDeliverablesService: program-wide dates', () => {
  const titled = <T extends { titleSnapshot: string }>(items: T[], title: string): T =>
    items.find((item) => item.titleSnapshot === title)!;

  async function withProgramWideGiveaway() {
    const context = setup();
    await context.service.updateTemplate(ORG, 'p-idi', 't-giveaway', { programWideDate: true });
    return context;
  }

  it("applies the program's date to every member's open checklist for that month", async () => {
    const { service } = await withProgramWideGiveaway();
    const first = await service.getCurrent(ORG, 'e-idi', OCT);
    await service.getCurrent(ORG, 'e-idi-2', OCT);
    // One member already received it; their status stays, only the date is filled in.
    await service.updateDeliverable(ORG, staff, 'e-idi', titled(first.items, 'Grant Giveaway').id, { status: 'DELIVERED' });

    const result = await service.setProgramDate(ORG, 'p-idi', 't-giveaway', { month: '2026-10', scheduledFor: '2026-10-18' });
    expect(result).toEqual(expect.objectContaining({ label: 'October 2026', clientsUpdated: 2 }));

    const mine = titled((await service.getCurrent(ORG, 'e-idi', OCT)).items, 'Grant Giveaway');
    const theirs = await service.getCurrent(ORG, 'e-idi-2', OCT);
    const theirGiveaway = titled(theirs.items, 'Grant Giveaway');
    expect(mine).toEqual(expect.objectContaining({ status: 'DELIVERED', scheduledFor: new Date('2026-10-18'), dateSetByProgram: true }));
    expect(theirGiveaway).toEqual(expect.objectContaining({ status: 'SCHEDULED', scheduledFor: new Date('2026-10-18'), dateSetByProgram: true }));
    // Other deliverables keep per-client dates, and the date becomes the next program action.
    expect(titled(theirs.items, 'Networking Event').dateSetByProgram).toBe(false);
    expect(theirs.nextAction?.titleSnapshot).toBe('Grant Giveaway');
  });

  it('leaves finalized months, other months and other programs alone', async () => {
    const { rows, service } = await withProgramWideGiveaway();
    const october = await service.getCurrent(ORG, 'e-idi', OCT);
    await service.finalizeCycle(ORG, staff, 'e-idi', october.cycle!.id);
    await service.getCurrent(ORG, 'e-idi', NOV);
    await service.getCurrent(ORG, 'e-coach', OCT);

    const result = await service.setProgramDate(ORG, 'p-idi', 't-giveaway', { month: '2026-10', scheduledFor: '2026-10-18' });
    expect(result.clientsUpdated).toBe(0);
    expect(rows.cfEnrollmentDeliverable.filter((row) => row.scheduledFor)).toHaveLength(0);
  });

  it('pre-fills the date on checklists created after it was set', async () => {
    const { service } = await withProgramWideGiveaway();
    await service.setProgramDate(ORG, 'p-idi', 't-giveaway', { month: '2026-11', scheduledFor: '2026-11-15' });

    const november = await service.getCurrent(ORG, 'e-idi', NOV);
    expect(titled(november.items, 'Grant Giveaway')).toEqual(expect.objectContaining({ status: 'SCHEDULED', scheduledFor: new Date('2026-11-15') }));
    expect(titled(november.items, 'Networking Event')).toEqual(expect.objectContaining({ status: 'NOT_STARTED' }));
    // October has no program date, so October's checklist starts undated.
    expect(titled((await service.getCurrent(ORG, 'e-idi', OCT)).items, 'Grant Giveaway').scheduledFor ?? null).toBeNull();
  });

  it("locks the date on the client's checklist while it is program-wide, and frees it when turned off", async () => {
    const { service } = await withProgramWideGiveaway();
    const id = titled((await service.getCurrent(ORG, 'e-idi', OCT)).items, 'Grant Giveaway').id;

    await expect(service.updateDeliverable(ORG, staff, 'e-idi', id, { scheduledFor: '2026-10-20' })).rejects.toBeInstanceOf(ConflictException);
    // Status, notes and outcome stay per client.
    await expect(service.updateDeliverable(ORG, staff, 'e-idi', id, { status: 'COMPLETED', notes: 'Attended' })).resolves.toEqual(
      expect.objectContaining({ status: 'COMPLETED', notes: 'Attended' }),
    );

    await service.updateTemplate(ORG, 'p-idi', 't-giveaway', { programWideDate: false });
    await expect(service.updateDeliverable(ORG, staff, 'e-idi', id, { scheduledFor: '2026-10-20' })).resolves.toEqual(
      expect.objectContaining({ scheduledFor: new Date('2026-10-20') }),
    );
  });

  it('lists the month, clears a date, and refuses per-client deliverables and dates outside the month', async () => {
    const { rows, service } = await withProgramWideGiveaway();
    await service.getCurrent(ORG, 'e-idi', OCT);
    await service.setProgramDate(ORG, 'p-idi', 't-giveaway', { month: '2026-10', scheduledFor: '2026-10-18' });
    expect(await service.listProgramDates(ORG, 'p-idi', '2026-10')).toEqual({
      month: '2026-10',
      label: 'October 2026',
      items: [{ templateId: 't-giveaway', title: 'Grant Giveaway', scheduledFor: new Date('2026-10-18') }],
    });

    await service.setProgramDate(ORG, 'p-idi', 't-giveaway', { month: '2026-10', scheduledFor: null });
    expect(rows.cfProgramDeliverableSchedule).toHaveLength(0);
    expect((await service.listProgramDates(ORG, 'p-idi', '2026-10')).items[0].scheduledFor).toBeNull();
    expect(titled((await service.getCurrent(ORG, 'e-idi', OCT)).items, 'Grant Giveaway').scheduledFor).toBeNull();

    await expect(service.setProgramDate(ORG, 'p-idi', 't-event', { month: '2026-10', scheduledFor: '2026-10-18' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.setProgramDate(ORG, 'p-idi', 't-giveaway', { month: '2026-10', scheduledFor: '2026-11-01' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.listProgramDates(ORG, 'p-idi', 'October')).rejects.toBeInstanceOf(BadRequestException);
  });

  it("never sets dates on another organization's program", async () => {
    const { rows, service } = await withProgramWideGiveaway();
    await expect(service.setProgramDate(OTHER_ORG, 'p-idi', 't-giveaway', { month: '2026-10', scheduledFor: '2026-10-18' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.setProgramDate(ORG, 'p-foreign', 't-foreign', { month: '2026-10', scheduledFor: '2026-10-18' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.listProgramDates(ORG, 'p-foreign', '2026-10')).rejects.toBeInstanceOf(NotFoundException);
    expect(rows.cfProgramDeliverableSchedule).toHaveLength(0);
  });
});
