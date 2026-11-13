import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import type { PrismaService } from '../../prisma/prisma.service';
import { inMemoryDb } from '../../invariants/in-memory-db';
import { ProgramDeliverablesService } from '../deliverables/program-deliverables.service';
import { CLOSURE_NOTE_REQUIRED, FinalReportsService, type FinalReportSnapshot } from './final-reports.service';
import { Prisma } from '../../generated/clientflow';

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

  describe('closure review', () => {
    /** An unfinished deliverable, an unsigned award agreement and a half-paid award on e-idi. */
    async function withOpenItems() {
      const ctx = setup();
      const october = await ctx.deliverables.getCurrent(ORG, 'e-idi', OCT);
      ctx.rows.cfEnrollmentAward = [{
        id: 'aw1', organizationId: ORG, clientId: 'c1', enrollmentId: 'e-idi', programId: 'p-idi', title: 'Growth Grant',
        source: 'IDI Member Fund', amountAwarded: new Prisma.Decimal(5000), awardDate: new Date('2026-10-01T04:00:00Z'),
        status: 'agreement_signed', currentAgreementId: 'k-award', createdAt: OCT,
      }];
      ctx.rows.cfAwardPayment = [
        { id: 'pay1', organizationId: ORG, awardId: 'aw1', amount: new Prisma.Decimal(2500), voidedAt: null },
        { id: 'pay-void', organizationId: ORG, awardId: 'aw1', amount: new Prisma.Decimal(999), voidedAt: OCT },
      ];
      ctx.rows.cfContract.push(
        { id: 'k-award', organizationId: ORG, clientId: 'c1', enrollmentId: 'e-idi', status: 'COMPLETED', contractType: 'Award Agreement', purpose: 'award', staffSignedAt: OCT, createdAt: OCT },
        { id: 'k-open', organizationId: ORG, clientId: 'c1', enrollmentId: 'e-idi', status: 'SENT', contractType: 'Second Award Agreement', purpose: 'award', staffSignedAt: OCT, createdAt: OCT },
      );
      return { ...ctx, deliverableId: october.items[0].id };
    }

    it('lists unsigned agreements, unfinished deliverables and unpaid awards', async () => {
      const { service } = await withOpenItems();
      const review = await service.closureReview(ORG, 'e-idi', OCT);
      expect(review.items).toEqual([
        expect.objectContaining({ kind: 'agreement', id: 'k-open', detail: 'Award agreement sent, not signed' }),
        expect.objectContaining({ kind: 'deliverable', label: 'Grant Giveaway' }),
        expect.objectContaining({ kind: 'award', id: 'aw1', detail: '$2,500.00 still owed of $5,000.00 awarded' }),
      ]);
      expect(review.reviewHash).toMatch(/^[a-f0-9]{64}$/);
      await expect(service.closureReview(OTHER, 'e-idi')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('will not close with open items unless staff record why, and archives nothing when refused', async () => {
      const { rows, service } = await withOpenItems();
      const draft = await service.createDraft(ORG, 'c1', { enrollmentId: 'e-idi' });
      await expect(service.finalize(ORG, staff, draft.id, { outcome: 'Closed Early', confirm: true }, OCT))
        .rejects.toThrow(CLOSURE_NOTE_REQUIRED);
      expect(rows.cfProgramEnrollment.find((row) => row.id === 'e-idi')).toEqual(expect.objectContaining({ isArchived: false }));
    });

    it('refuses when the open items changed since staff reviewed them', async () => {
      const { rows, service, deliverableId } = await withOpenItems();
      const review = await service.closureReview(ORG, 'e-idi', OCT);
      // The deliverable gets resolved after the review was shown.
      rows.cfEnrollmentDeliverable.find((row) => row.id === deliverableId)!.status = 'DELIVERED';
      const draft = await service.createDraft(ORG, 'c1', { enrollmentId: 'e-idi' });
      await expect(service.finalize(ORG, staff, draft.id, {
        outcome: 'Closed Early', confirm: true, closureNote: 'Business closed', reviewHash: review.reviewHash,
      }, OCT)).rejects.toBeInstanceOf(ConflictException);
    });

    it('finalizes with a reason, keeping what was open and the awards in the report', async () => {
      const { rows, service } = await withOpenItems();
      const review = await service.closureReview(ORG, 'e-idi', OCT);
      const draft = await service.createDraft(ORG, 'c1', { enrollmentId: 'e-idi' });
      const finalized = await service.finalize(ORG, staff, draft.id, {
        outcome: 'Closed Early', confirm: true, closureNote: 'Business relocated out of state.', reviewHash: review.reviewHash,
      }, OCT);
      const snapshot = finalized.snapshot as unknown as FinalReportSnapshot;
      expect(snapshot.closureReview).toEqual({ items: review.items, note: 'Business relocated out of state.', reviewedAt: OCT.toISOString() });
      expect(snapshot.awards).toEqual([expect.objectContaining({
        title: 'Growth Grant', amountAwarded: 5000, received: 2500, outstanding: 2500, paymentState: 'partially_paid', agreementStatus: 'COMPLETED',
      })]);
      expect(snapshot.awardTotals).toEqual({ awarded: 5000, received: 2500, outstanding: 2500 });
      // Requested funding and proposed terms stay separate from what was awarded.
      expect(snapshot).toEqual(expect.objectContaining({ statedFundingNeed: '$25,000', termsAmount: '$5,000.00' }));
      expect(rows.cfActivityLog.find((row) => row.action === 'FINAL_REPORT_FINALIZED')?.description)
        .toContain('Business relocated out of state.');
      // The unpaid award is untouched by closing the participation.
      expect(rows.cfEnrollmentAward[0]).toEqual(expect.objectContaining({ status: 'agreement_signed' }));
    });
  });
});
