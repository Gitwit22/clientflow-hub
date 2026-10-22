import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CfFinalReport, Prisma } from '../../generated/clientflow';
import { findClientForOrg, findEnrollmentForOrg } from '../../common/tenancy/org-scoped.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { ProgramDeliverablesService, type ProgramHistory } from '../deliverables/program-deliverables.service';
import { archiveProgramParticipation, isProgramOutcome, PROGRAM_OUTCOMES } from '../lifecycle/final-report';

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
}

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
    input: { outcome?: unknown; confirm?: unknown } & Record<string, unknown>,
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

    return this.prisma.$transaction(async (transaction) => {
      // Claim the draft first so two finalize requests cannot both archive and snapshot.
      const claimed = await transaction.cfFinalReport.updateMany({
        where: { id: report.id, organizationId, status: FINAL_REPORT_STATUS.draft },
        data: { ...narrative, status: FINAL_REPORT_STATUS.finalized, finalizedAt: now, finalizedByUserId: actor.id, finalizedByDisplayName: actor.displayName, archiveDecision: outcome },
      });
      if (claimed.count !== 1) throw new ConflictException('This report is already finalized.');

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
      };
      await transaction.cfActivityLog.create({
        data: {
          organizationId,
          clientId: report.clientId,
          enrollmentId: report.enrollmentId,
          actorUserId: actor.id,
          action: 'FINAL_REPORT_FINALIZED',
          description: `Final report finalized (${outcome}); participation in ${facts.programName} archived (${archive.status}).`,
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
    });
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
    db: Pick<PrismaService, 'cfClient' | 'cfProgram' | 'cfProgramEnrollment' | 'cfTerms'> = this.prisma,
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
    };
  }
}
