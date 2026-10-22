import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { inMemoryDb } from '../../invariants/in-memory-db';
import { ProgramDeliverablesService } from '../deliverables/program-deliverables.service';
import { FinalReportsService, type FinalReportSnapshot } from './final-reports.service';

type Row = Record<string, unknown>;
const ORG = 'org-a';
const OTHER = 'org-b';
const staff = { id: 'admin-1', displayName: 'Jordan Lee' };
const OCT = new Date('2026-10-15T15:00:00.000Z');

function setup() {
  const rows: Record<string, Row[]> = {
    organization: [{ id: ORG, settings: { timezone: 'America/Detroit' } }, { id: OTHER, settings: {} }],
    cfProgram: [{ id: 'p-idi', organizationId: ORG, name: 'IDI' }, { id: 'p-coach', organizationId: ORG, name: 'Coaching' }],
    cfClient: [{
      id: 'c1', organizationId: ORG, businessName: 'Moonlight Minerals', primaryContactName: 'Pat', isArchived: false, isDemo: false,
      intake: { assistanceRequested: 'Equipment grant', budgetNeed: '$25,000' },
    }],
    cfProgramEnrollment: [
      { id: 'e-idi', organizationId: ORG, clientId: 'c1', programId: 'p-idi', status: 'active', isArchived: false, isDemo: false, startDate: new Date('2026-09-02T00:00:00.000Z') },
      { id: 'e-coach', organizationId: ORG, clientId: 'c1', programId: 'p-coach', status: 'active', isArchived: false, isDemo: false },
    ],
    cfProgramDeliverableTemplate: [
      { id: 't1', organizationId: ORG, programId: 'p-idi', title: 'Grant Giveaway', description: null, cadence: 'MONTHLY', active: true, programWideDate: false, sortOrder: 0 },
    ],
    cfTerms: [{ id: 'tm1', organizationId: ORG, clientId: 'c1', enrollmentId: 'e-idi', fundingAmount: 5000 }],
    cfEnrollmentDeliverableCycle: [],
    cfEnrollmentDeliverable: [],
    cfProgramDeliverableSchedule: [],
    cfFinalReport: [],
    cfActivityLog: [],
    cfEnrollmentStatusHistory: [],
    cfContract: [],
    cfFormAssignment: [],
    cfEnrollmentBillingAgreement: [
      { id: 'b-idi', organizationId: ORG, enrollmentId: 'e-idi', status: 'active' },
      { id: 'b-coach', organizationId: ORG, enrollmentId: 'e-coach', status: 'active' },
    ],
  };
  const db = inMemoryDb(rows, { cfEnrollmentDeliverableCycle: [['enrollmentId', 'cadence', 'periodStart']] }) as unknown as PrismaService;
  const deliverables = new ProgramDeliverablesService(db);
  return { rows, deliverables, service: new FinalReportsService(db, deliverables) };
}

describe('final reports', () => {
  it('saving a draft changes nothing else, and the draft stays editable', async () => {
    const { rows, service } = setup();
    const before = JSON.stringify({ enrollments: rows.cfProgramEnrollment, billing: rows.cfEnrollmentBillingAgreement, client: rows.cfClient });
    const draft = await service.createDraft(ORG, 'c1', { enrollmentId: 'e-idi', resultsAchieved: 'Bought a kiln', archiveDecision: 'Archived' });

    expect(draft).toEqual(expect.objectContaining({ status: 'DRAFT', archiveDecision: '', programId: 'p-idi', resultsAchieved: 'Bought a kiln', fundingProvided: '$5,000.00', originalNeed: 'Equipment grant' }));
    expect(JSON.stringify({ enrollments: rows.cfProgramEnrollment, billing: rows.cfEnrollmentBillingAgreement, client: rows.cfClient })).toBe(before);

    const edited = await service.updateDraft(ORG, draft.id, { resultsAchieved: 'Bought a kiln and a wheel', staffComments: 'Great progress' });
    expect(edited).toEqual(expect.objectContaining({ resultsAchieved: 'Bought a kiln and a wheel', staffComments: 'Great progress', status: 'DRAFT' }));
  });

  it('finalizing needs a confirmation and a program outcome', async () => {
    const { service } = setup();
    const draft = await service.createDraft(ORG, 'c1', { enrollmentId: 'e-idi' });
    await expect(service.finalize(ORG, staff, draft.id, { outcome: 'Program Complete' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.finalize(ORG, staff, draft.id, { confirm: true })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.finalize(ORG, staff, draft.id, { outcome: 'Archived', confirm: true })).rejects.toBeInstanceOf(BadRequestException);
  });

  it('finalizing archives participation in that program only, keeps a snapshot, and runs once', async () => {
    const { rows, deliverables, service } = setup();
    const october = await deliverables.getCurrent(ORG, 'e-idi', OCT);
    await deliverables.updateDeliverable(ORG, staff, 'e-idi', october.items[0].id, { status: 'DELIVERED', outcome: '4 shared' });
    const draft = await service.createDraft(ORG, 'c1', { enrollmentId: 'e-idi' });

    const finalized = await service.finalize(ORG, staff, draft.id, { outcome: 'Program Complete', confirm: true, recommendedNextSteps: 'Apply for round 2' }, OCT);

    expect(finalized).toEqual(expect.objectContaining({
      status: 'FINALIZED',
      archiveDecision: 'Program Complete',
      finalizedByDisplayName: 'Jordan Lee',
      recommendedNextSteps: 'Apply for round 2',
    }));
    const idi = rows.cfProgramEnrollment.find((row) => row.id === 'e-idi')!;
    const coaching = rows.cfProgramEnrollment.find((row) => row.id === 'e-coach')!;
    expect(idi).toEqual(expect.objectContaining({ status: 'completed', isArchived: true }));
    expect(coaching).toEqual(expect.objectContaining({ status: 'active', isArchived: false }));
    expect(rows.cfClient[0].isArchived).toBe(false);
    expect(rows.cfEnrollmentBillingAgreement.map((row) => row.status)).toEqual(['ended', 'active']);
    expect(rows.cfActivityLog.some((row) => row.action === 'FINAL_REPORT_FINALIZED')).toBe(true);

    const snapshot = finalized.snapshot as unknown as FinalReportSnapshot;
    expect(snapshot).toEqual(expect.objectContaining({ programName: 'IDI', statedFundingNeed: '$25,000', termsAmount: '$5,000.00' }));
    expect(snapshot.history.months[0].items[0]).toEqual(expect.objectContaining({ status: 'DELIVERED', outcome: '4 shared' }));

    // Later edits to the records never change the finalized snapshot.
    rows.cfEnrollmentDeliverable[0].status = 'NOT_APPLICABLE';
    rows.cfTerms[0].fundingAmount = 9999;
    const reread = await service.get(ORG, draft.id);
    expect((reread.snapshot as unknown as FinalReportSnapshot).history.months[0].items[0].status).toBe('DELIVERED');
    expect((reread.snapshot as unknown as FinalReportSnapshot).termsAmount).toBe('$5,000.00');

    // A second finalize (double-click, retry) changes nothing; the report is read-only.
    await expect(service.finalize(ORG, staff, draft.id, { outcome: 'Defaulted', confirm: true })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.updateDraft(ORG, draft.id, { staffComments: 'changed' })).rejects.toBeInstanceOf(ConflictException);
    expect(rows.cfEnrollmentStatusHistory).toHaveLength(1);
  });

  it("never reads or changes another organization's reports or clients", async () => {
    const { rows, service } = setup();
    const draft = await service.createDraft(ORG, 'c1', { enrollmentId: 'e-idi' });
    await expect(service.get(OTHER, draft.id)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.updateDraft(OTHER, draft.id, { staffComments: 'x' })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.finalize(OTHER, staff, draft.id, { outcome: 'Program Complete', confirm: true })).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.createDraft(OTHER, 'c1', { enrollmentId: 'e-idi' })).rejects.toBeInstanceOf(NotFoundException);
    expect(rows.cfProgramEnrollment.every((row) => row.isArchived === false)).toBe(true);
  });
});
