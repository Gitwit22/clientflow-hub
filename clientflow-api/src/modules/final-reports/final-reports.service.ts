import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type CfFinalReport } from '../../generated/clientflow';
import { findClientForOrg, findEnrollmentForOrg } from '../../common/tenancy/org-scoped.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgramDeliverablesService, type ProgramHistory } from '../deliverables/program-deliverables.service';
import { outstandingOf, paymentStateOf, receivedOf, toAmount } from '../funding/award-rules';
import { archiveProgramParticipation, isProgramOutcome, PROGRAM_OUTCOMES } from '../lifecycle/final-report';
import { buildClosureReview, type ClosureReview, type ClosureReviewItem } from './closure-review';

export const FINAL_REPORT_STATUS = { draft: 'DRAFT', finalized: 'FINALIZED' } as const;

/** The parts of a final report staff write; everything else comes from ClientFlow's records. */
const NARRATIVE_FIELDS = [
  'resultsAchieved',
  'issuesEncountered',
  'staffComments',
  'clientOutcome',
  'recommendedNextSteps',
] as const;
type NarrativeField = (typeof NARRATIVE_FIELDS)[number];
export type FinalReportNarrative = Partial<Record<NarrativeField, string>>;

const FIELD_MAX = 10_000;

export interface ReportActor {
  id: string | null;
  displayName: string;
}

/**
 * What a finalized report showed, kept with it so later edits to deliverables, terms or the intake
 * never change it. Funding figures are what the client asked for and what the program's terms say;
 * neither is an amount actually awarded.
 */
export interface FinalReportSnapshot {
  capturedAt: string;
  clientName: string;
  businessName: string;
  programName: string;
  history: ProgramHistory;
  /** From the client's intake: what they said they needed. */
  statedFundingNeed: string | null;
  /** From the enrollment's terms record, as agreed in Terms. Not an award. */
  termsAmount: string | null;
  /** Funding awards for this participation, as recorded when finalized. Absent on older reports. */
  awards?: FinalReportAward[];
  awardTotals?: { awarded: number; received: number; outstanding: number };
  /** What was still open when the participation was closed, and why it closed anyway. */
  closureReview?: { items: ClosureReviewItem[]; note: string | null; reviewedAt: string };
}

export interface FinalReportAward {
  id: string;
  title: string;
  source: string;
  status: string;
  awardDate: string;
  amountAwarded: number;
  received: number;
  outstanding: number;
  paymentState: string;
  /** Status of the award's current agreement (e.g. COMPLETED), or null when it has none. */
  agreementStatus: string | null;
}

/** Shown when finalizing with open items and no reason recorded. */
export const CLOSURE_NOTE_REQUIRED =
  'Some items are still open (unsigned agreements, unfinished deliverables or unpaid awards). Resolve them or record why this participation is closing with them open.';
export const CLOSURE_REVIEW_CHANGED =
  'Something changed since you reviewed this participation. Review the open items again before finalizing.';

const CLOSURE_NOTE_MAX = 2000;
/** Serializable transactions can be refused under contention (P2034); finalizing then simply retries. */
const FINALIZE_ATTEMPTS = 3;

function money(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function narrativeFrom(input: Record<string, unknown>): FinalReportNarrative {
  const result: FinalReportNarrative = {};
  for (const field of NARRATIVE_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') throw new BadRequestException(`${field} must be text.`);
    const text = (value ?? '').trim();
    if (text.length > FIELD_MAX) throw new BadRequestException(`${field} is too long.`);
    result[field] = text;
  }
  return result;
}

/**
 * Final reports. A report is a DRAFT until staff finalize it: saving a draft changes nothing else.
 * Finalizing keeps a snapshot of what the report shows and archives the client's participation in
 * that one program (see archiveProgramParticipation). The client and their other programs are
 * untouched.
 */
@Injectable()
export class FinalReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly deliverables: ProgramDeliverablesService,
  ) {}

  async createDraft(organizationId: string, clientId: string, input: Record<string, unknown>): Promise<CfFinalReport> {
    const client = await findClientForOrg(this.prisma, organizationId, clientId, { includeArchived: true });
    const enrollmentId = typeof input.enrollmentId === 'string' ? input.enrollmentId : '';
    if (!enrollmentId) throw new BadRequestException('Choose the program enrollment this report is for.');
    const enrollment = await findEnrollmentForOrg(this.prisma, organizationId, enrollmentId, { clientId: client.id });
    const narrative = narrativeFrom(input);
    const facts = await this.recordedFacts(organizationId, client.id, enrollment.id);
    return this.prisma.cfFinalReport.create({
      data: {
        organizationId,
        clientId: client.id,
        enrollmentId: enrollment.id,
        programId: enrollment.programId,
        startDate: facts.startDate,
        endDate: facts.endDate,
        originalNeed: facts.originalNeed,
        supportProvided: facts.programName,
        fundingProvided: facts.termsAmount ?? '',
        milestonesCompleted: '',
        resultsAchieved: narrative.resultsAchieved ?? '',
        issuesEncountered: narrative.issuesEncountered ?? '',
        staffComments: narrative.staffComments ?? '',
        clientOutcome: narrative.clientOutcome ?? '',
        recommendedNextSteps: narrative.recommendedNextSteps ?? '',
        archiveDecision: '',
        status: FINAL_REPORT_STATUS.draft,
        isDemo: client.isDemo,
      },
    });
  }

  async updateDraft(organizationId: string, reportId: string, input: Record<string, unknown>): Promise<CfFinalReport> {
    const report = await this.requireReport(organizationId, reportId);
    const narrative = narrativeFrom(input);
    const updated = await this.prisma.cfFinalReport.updateMany({
      where: { id: report.id, organizationId, status: FINAL_REPORT_STATUS.draft },
      data: narrative,
    });
    if (updated.count !== 1) throw new ConflictException('This report is finalized and can no longer be edited.');
    return this.requireReport(organizationId, reportId);
  }

  /**
   * Finalizes a draft: keeps a snapshot of what it shows, then archives the client's participation
   * in its program. Requires an explicit confirmation and a program outcome. Runs once: a second
   * request (double-click, retry) finds it already finalized and changes nothing.
   */
  async finalize(
    organizationId: string,
    actor: ReportActor,
    reportId: string,
    input: { outcome?: unknown; confirm?: unknown; closureNote?: unknown; reviewHash?: unknown } & Record<string, unknown>,
    now: Date = new Date(),
  ): Promise<CfFinalReport> {
    if (input.confirm !== true) throw new BadRequestException('Confirm that this report should be finalized and the participation archived.');
    if (!isProgramOutcome(input.outcome)) {
      throw new BadRequestException(`Choose the program outcome: ${PROGRAM_OUTCOMES.join(', ')}.`);
    }
    const outcome = input.outcome;
    const report = await this.requireReport(organizationId, reportId);
    if (report.status !== FINAL_REPORT_STATUS.draft) {
      throw new ConflictException('This report is already finalized.');
    }
    if (!report.enrollmentId) throw new BadRequestException('This report is not tied to a program enrollment.');
    const narrative = narrativeFrom(input);
    const closureNote = typeof input.closureNote === 'string' && input.closureNote.trim() ? input.closureNote.trim() : null;
    if (input.closureNote !== undefined && input.closureNote !== null && typeof input.closureNote !== 'string') {
      throw new BadRequestException('closureNote must be text.');
    }
    if (closureNote && closureNote.length > CLOSURE_NOTE_MAX) throw new BadRequestException('The closure note is too long.');
    const reviewHash = typeof input.reviewHash === 'string' && input.reviewHash ? input.reviewHash : null;

    // Serializable: the open items checked here are exactly the ones committed with the report,
    // even if a payment, signature or deliverable changes at the same moment (that request or this
    // one is retried or refused).
    for (let attempt = 1; ; attempt += 1) {
      try {
        return await this.prisma.$transaction(
          (transaction) => this.finalizeIn(transaction, organizationId, actor, report, { outcome, narrative, closureNote, reviewHash }, now),
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        );
      } catch (error) {
        const retryable = (error as { code?: string })?.code === 'P2034';
        if (!retryable || attempt >= FINALIZE_ATTEMPTS) throw error;
      }
    }
  }

  /** The open items left on a participation, for the review shown before finalizing. */
  async closureReview(organizationId: string, enrollmentId: string, now: Date = new Date()): Promise<ClosureReview> {
    await findEnrollmentForOrg(this.prisma, organizationId, enrollmentId);
    return buildClosureReview(this.prisma, organizationId, enrollmentId, now);
  }

  private async finalizeIn(
    transaction: Prisma.TransactionClient,
    organizationId: string,
    actor: ReportActor,
    report: CfFinalReport,
    input: { outcome: string; narrative: FinalReportNarrative; closureNote: string | null; reviewHash: string | null },
    now: Date,
  ): Promise<CfFinalReport> {
    const { outcome, narrative, closureNote } = input;
    {
      // Claim the draft first so two finalize requests cannot both archive and snapshot.
      const claimed = await transaction.cfFinalReport.updateMany({
        where: { id: report.id, organizationId, status: FINAL_REPORT_STATUS.draft },
        data: { ...narrative, status: FINAL_REPORT_STATUS.finalized, finalizedAt: now, finalizedByUserId: actor.id, finalizedByDisplayName: actor.displayName, archiveDecision: outcome },
      });
      if (claimed.count !== 1) throw new ConflictException('This report is already finalized.');

      // Checked before anything is archived (archiving cancels open agreements), with this
      // transaction's own reads.
      const review = await buildClosureReview(transaction, organizationId, report.enrollmentId!, now);
      if (input.reviewHash && input.reviewHash !== review.reviewHash) throw new ConflictException(CLOSURE_REVIEW_CHANGED);
      if (review.items.length && !closureNote) throw new BadRequestException(CLOSURE_NOTE_REQUIRED);

      const archive = await archiveProgramParticipation(
        transaction,
        { organizationId, clientId: report.clientId, enrollmentId: report.enrollmentId!, outcome, actor: { id: actor.id, name: actor.displayName } },
        now,
      );
      // The snapshot is taken after the participation closed, so its months end where it ended.
      const facts = await this.recordedFacts(organizationId, report.clientId, report.enrollmentId!, now, transaction);
      const snapshot: FinalReportSnapshot = {
        capturedAt: now.toISOString(),
        clientName: facts.clientName,
        businessName: facts.businessName,
        programName: facts.programName,
        history: facts.history,
        statedFundingNeed: facts.history.originalRequest.budgetNeed,
        termsAmount: facts.termsAmount,
        awards: facts.awards,
        awardTotals: facts.awardTotals,
        closureReview: { items: review.items, note: closureNote, reviewedAt: review.reviewedAt },
      };
      await transaction.cfActivityLog.create({
        data: {
          organizationId,
          clientId: report.clientId,
          enrollmentId: report.enrollmentId,
          actorUserId: actor.id,
          action: 'FINAL_REPORT_FINALIZED',
          description: `Final report finalized (${outcome}); participation in ${facts.programName} archived (${archive.status}).${
            review.items.length ? ` Closed with ${review.items.length} open item${review.items.length === 1 ? '' : 's'}: ${closureNote}` : ''
          }`,
          user: actor.displayName,
          source: 'manual_staff_action',
          isDemo: report.isDemo,
        },
      });
      return transaction.cfFinalReport.update({
        where: { id: report.id },
        data: {
          snapshot: snapshot as unknown as Prisma.InputJsonValue,
          startDate: facts.startDate,
          endDate: facts.endDate || now.toISOString(),
          originalNeed: facts.originalNeed,
          supportProvided: facts.programName,
          fundingProvided: facts.termsAmount ?? '',
          milestonesCompleted: facts.history.months
            .map((month) => `${month.label}: ${month.recorded ? `${month.summary.deliveredOrCompleted} of ${month.summary.total} delivered` : 'no activity recorded'}`)
            .join('; '),
        },
      });
    }
  }

  async get(organizationId: string, reportId: string): Promise<CfFinalReport> {
    return this.requireReport(organizationId, reportId);
  }

  private async requireReport(organizationId: string, reportId: string) {
    const report = await this.prisma.cfFinalReport.findFirst({ where: { id: reportId, organizationId } });
    if (!report) throw new NotFoundException('Final report not found.');
    return report;
  }

  /** What ClientFlow already knows about this client's time in the program. */
  private async recordedFacts(
    organizationId: string,
    clientId: string,
    enrollmentId: string,
    now: Date = new Date(),
    db: Pick<PrismaService, 'cfClient' | 'cfProgram' | 'cfProgramEnrollment' | 'cfTerms' | 'cfEnrollmentAward' | 'cfAwardPayment' | 'cfContract'> = this.prisma,
  ) {
    const [client, enrollment, terms] = await Promise.all([
      db.cfClient.findFirst({ where: { id: clientId, organizationId }, select: { businessName: true, primaryContactName: true } }),
      db.cfProgramEnrollment.findFirst({ where: { id: enrollmentId, organizationId, clientId } }),
      db.cfTerms.findFirst({ where: { organizationId, clientId, enrollmentId }, orderBy: { createdAt: 'desc' }, select: { fundingAmount: true } }),
    ]);
    if (!client || !enrollment) throw new NotFoundException('Enrollment not found.');
    const program = await db.cfProgram.findFirst({ where: { id: enrollment.programId, organizationId }, select: { name: true } });
    const history = await this.deliverables.getProgramHistory(organizationId, enrollment.id, now);
    const ended = enrollment.completedAt ?? enrollment.withdrawnAt ?? null;
    return {
      clientName: client.primaryContactName,
      businessName: client.businessName,
      programName: program?.name ?? '',
      history,
      startDate: enrollment.startDate?.toISOString() ?? '',
      endDate: ended?.toISOString() ?? '',
      originalNeed: history.originalRequest.assistanceRequested ?? '',
      termsAmount: terms && terms.fundingAmount > 0 ? money(terms.fundingAmount) : null,
      ...(await this.awardFacts(db, organizationId, enrollment.id)),
    };
  }

  /** Funding awards for the report: awarded, received and still owed, plus each agreement's status. */
  private async awardFacts(
    db: Pick<PrismaService, 'cfEnrollmentAward' | 'cfAwardPayment' | 'cfContract'>,
    organizationId: string,
    enrollmentId: string,
  ): Promise<{ awards: FinalReportAward[]; awardTotals: { awarded: number; received: number; outstanding: number } }> {
    const awards = await db.cfEnrollmentAward.findMany({
      where: { organizationId, enrollmentId },
      orderBy: [{ awardDate: 'asc' }, { createdAt: 'asc' }],
    });
    if (!awards.length) return { awards: [], awardTotals: { awarded: 0, received: 0, outstanding: 0 } };
    const agreementIds = awards.map((award) => award.currentAgreementId).filter((id): id is string => Boolean(id));
    const [payments, agreements] = await Promise.all([
      db.cfAwardPayment.findMany({
        where: { organizationId, awardId: { in: awards.map((award) => award.id) } },
        select: { awardId: true, amount: true, voidedAt: true },
      }),
      agreementIds.length
        ? db.cfContract.findMany({ where: { organizationId, id: { in: agreementIds } }, select: { id: true, status: true } })
        : Promise.resolve([]),
    ]);
    const agreementStatus = new Map(agreements.map((agreement) => [agreement.id, agreement.status]));
    const rows = awards.map((award): FinalReportAward => {
      const received = receivedOf(payments.filter((payment) => payment.awardId === award.id));
      return {
        id: award.id,
        title: award.title,
        source: award.source,
        status: award.status,
        awardDate: award.awardDate.toISOString(),
        amountAwarded: toAmount(award.amountAwarded),
        received: toAmount(received),
        outstanding: toAmount(outstandingOf(award, received)),
        paymentState: paymentStateOf(award.amountAwarded, received),
        agreementStatus: award.currentAgreementId ? agreementStatus.get(award.currentAgreementId) ?? null : null,
      };
    });
    // Cancelled awards are listed, but not counted in the totals.
    const counted = rows.filter((row) => row.status !== 'cancelled');
    const total = (pick: (row: FinalReportAward) => number) => Math.round(counted.reduce((sum, row) => sum + pick(row) * 100, 0)) / 100;
    return {
      awards: rows,
      awardTotals: { awarded: total((row) => row.amountAwarded), received: total((row) => row.received), outstanding: total((row) => row.outstanding) },
    };
  }
}
