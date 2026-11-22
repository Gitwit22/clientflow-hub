import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type {
  CfDeliverableStatus,
  CfEnrollmentDeliverable,
  CfEnrollmentDeliverableCycle,
  CfProgramEnrollment,
  Prisma,
} from '../../generated/clientflow';
import { findEnrollmentForOrg, findProgramForOrg, type TenantDb } from '../../common/tenancy/org-scoped.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { mergeDeliverables } from './deliverable-merge';
import { getCalendarPeriodBounds } from '../billing/billing-schedule.util';
import { isUniqueViolation } from '../communications/communication-attempts';
import {
  hasRecordedActivity,
  isDone,
  isResolved,
  selectNextAction,
  summarizeDeliverables,
  type DeliverableSummary,
} from './deliverable-summary';
import type {
  ConfirmDeliverableForMembersDto,
  CreateDeliverableTemplateDto,
  ReorderDeliverableTemplatesDto,
  SetProgramDeliverableDateDto,
  UpdateDeliverableTemplateDto,
} from './dto/deliverable-template.dto';
import type { UpdateEnrollmentDeliverableDto } from './dto/update-enrollment-deliverable.dto';

export interface DeliverableActor {
  id: string | null;
  displayName: string;
}

/** Events that can complete a program deliverable on their own (CfProgramDeliverableTemplate.completeOn). */
export const DELIVERABLE_TRIGGERS = [
  'form_submitted',
  'payment_recorded',
  'agreement_signed',
  'document_uploaded',
  'checkin_recorded',
] as const;
export type DeliverableTrigger = (typeof DELIVERABLE_TRIGGERS)[number];

export const DELIVERABLE_ACTIVITY = {
  autoCompleted: 'PROGRAM_DELIVERABLE_AUTO_COMPLETED',
  statusChanged: 'PROGRAM_DELIVERABLE_STATUS_CHANGED',
  completed: 'PROGRAM_DELIVERABLE_COMPLETED',
  nextActionSet: 'PROGRAM_DELIVERABLE_NEXT_ACTION_SET',
  cycleFinalized: 'PROGRAM_DELIVERABLE_CYCLE_FINALIZED',
} as const;

const STATUS_LABELS: Record<CfDeliverableStatus, string> = {
  NOT_STARTED: 'Not started',
  AVAILABLE: 'Available',
  SCHEDULED: 'Scheduled',
  IN_PROGRESS: 'In progress',
  DELIVERED: 'Delivered',
  COMPLETED: 'Completed',
  NOT_APPLICABLE: 'Not applicable',
};

/** A client deliverable as shown to staff: whether its date comes from the program. */
export type DeliverableView = CfEnrollmentDeliverable & { dateSetByProgram: boolean };

export interface CycleView {
  cycle: CfEnrollmentDeliverableCycle;
  items: DeliverableView[];
  summary: DeliverableSummary;
  nextAction: DeliverableView | null;
}

export type CurrentCycleView =
  | (CycleView & { reason: null })
  | { cycle: null; items: []; summary: DeliverableSummary; nextAction: null; reason: 'no_deliverables_configured' | 'enrollment_not_active' };

/** One member's next action for the program's member list. */
export interface MemberNextAction {
  cycleLabel: string;
  title: string | null;
  status: CfDeliverableStatus | null;
  scheduledFor: Date | null;
  delivered: number;
  total: number;
  /** Every deliverable this period is delivered, completed or not applicable. */
  allResolved: boolean;
}

export interface ProgramHistory {
  enrollmentId: string;
  programId: string;
  joinedAt: Date | null;
  endedAt: Date | null;
  /** What the client asked for on the intake. */
  originalRequest: { assistanceRequested: string | null; budgetNeed: string | null };
  /**
   * Every month from the first checklist to the current month (or the month the enrollment ended),
   * oldest first. A month nobody opened has no record: `recorded: false`, no items. It is shown as
   * such, never filled in.
   */
  months: Array<{
    cycleId: string | null;
    recorded: boolean;
    label: string;
    periodStart: Date;
    periodEnd: Date;
    status: CfEnrollmentDeliverableCycle['status'] | null;
    finalizedAt: Date | null;
    summary: DeliverableSummary;
    items: Array<{
      id: string;
      title: string;
      status: CfDeliverableStatus;
      scheduledFor: Date | null;
      completedAt: Date | null;
      outcome: string | null;
      notes: string | null;
    }>;
  }>;
}

const EMPTY_SUMMARY: DeliverableSummary = { total: 0, deliveredOrCompleted: 0, available: 0, notApplicable: 0, open: 0, withActivity: 0 };

function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

const MONTH_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** "" and whitespace-only text are stored as null. */
function optionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined;
  const trimmed = value?.trim() ?? '';
  return trimmed ? trimmed : null;
}

/**
 * Program Deliverables: what a program promises its clients each period, and what was actually
 * provided to each enrolled client. Generic for every program; titles are program data.
 *
 * Templates (per program) → one cycle per enrollment per period → one deliverable per active
 * template, snapshotted when the cycle is created so later template changes never rewrite history.
 */
@Injectable()
export class ProgramDeliverablesService {
  private readonly logger = new Logger(ProgramDeliverablesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** The current time (one place, so "this month" is consistent and testable). */
  private now(): Date {
    return new Date();
  }

  /**
   * Merges one deliverable into another of the same program (see deliverable-merge.ts). With
   * apply false it only reports what would change; applying runs in one transaction.
   */
  async mergeTemplates(organizationId: string, programId: string, fromTemplateId: string, intoTemplateId: string, apply: boolean) {
    await findProgramForOrg(this.prisma, organizationId, programId);
    if (!apply) return mergeDeliverables(this.prisma, organizationId, programId, fromTemplateId, intoTemplateId, false);
    return this.prisma.$transaction(
      (tx) => mergeDeliverables(tx, organizationId, programId, fromTemplateId, intoTemplateId, true),
      { timeout: 30_000, maxWait: 10_000 },
    );
  }

  // ---------------------------------------------------------------------------------------------
  // Program templates
  // ---------------------------------------------------------------------------------------------

  async listTemplates(organizationId: string, programId: string) {
    await findProgramForOrg(this.prisma, organizationId, programId);
    return this.prisma.cfProgramDeliverableTemplate.findMany({
      where: { organizationId, programId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
  }

  async createTemplate(organizationId: string, programId: string, dto: CreateDeliverableTemplateDto) {
    await findProgramForOrg(this.prisma, organizationId, programId);
    const title = dto.title.trim();
    if (!title) throw new BadRequestException('A deliverable needs a title.');
    const last = await this.prisma.cfProgramDeliverableTemplate.findFirst({
      where: { organizationId, programId },
      orderBy: { sortOrder: 'desc' },
      select: { sortOrder: true },
    });
    const created = await this.prisma.cfProgramDeliverableTemplate.create({
      data: {
        organizationId,
        programId,
        title,
        description: optionalText(dto.description) ?? null,
        cadence: dto.cadence ?? 'MONTHLY',
        active: dto.active ?? true,
        programWideDate: dto.programWideDate ?? false,
        sortOrder: (last?.sortOrder ?? -1) + 1,
        ...(await this.autoCompleteSetting(organizationId, dto.completeOn ?? null, dto.completeOnFormId ?? null)),
      },
    });
    await this.syncCurrentChecklists(organizationId, programId);
    return created;
  }

  async updateTemplate(
    organizationId: string,
    programId: string,
    templateId: string,
    dto: UpdateDeliverableTemplateDto,
  ) {
    await this.requireTemplate(organizationId, programId, templateId);
    const data: Prisma.CfProgramDeliverableTemplateUpdateInput = {};
    if (dto.title !== undefined) {
      const title = dto.title.trim();
      if (!title) throw new BadRequestException('A deliverable needs a title.');
      data.title = title;
    }
    if (dto.description !== undefined) data.description = optionalText(dto.description);
    if (dto.cadence !== undefined) data.cadence = dto.cadence;
    if (dto.active !== undefined) data.active = dto.active;
    if (dto.programWideDate !== undefined) data.programWideDate = dto.programWideDate;
    if (dto.completeOn !== undefined || dto.completeOnFormId !== undefined) {
      const current = await this.requireTemplate(organizationId, programId, templateId);
      Object.assign(
        data,
        await this.autoCompleteSetting(
          organizationId,
          dto.completeOn !== undefined ? dto.completeOn : (current.completeOn as DeliverableTrigger | null),
          dto.completeOnFormId !== undefined ? dto.completeOnFormId : current.completeOnFormId,
        ),
      );
    }
    const updated = await this.prisma.cfProgramDeliverableTemplate.update({ where: { id: templateId, organizationId }, data });
    await this.syncCurrentChecklists(organizationId, programId);
    return updated;
  }

  async reorderTemplates(organizationId: string, programId: string, dto: ReorderDeliverableTemplatesDto) {
    await findProgramForOrg(this.prisma, organizationId, programId);
    const existing = await this.prisma.cfProgramDeliverableTemplate.findMany({
      where: { organizationId, programId },
      select: { id: true },
    });
    const ids = new Set(existing.map((template) => template.id));
    const ordered = dto.orderedIds;
    if (ordered.length !== ids.size || new Set(ordered).size !== ordered.length || !ordered.every((id) => ids.has(id))) {
      throw new BadRequestException("The new order must list each of this program's deliverables exactly once.");
    }
    await this.prisma.$transaction(
      ordered.map((id, index) =>
        this.prisma.cfProgramDeliverableTemplate.updateMany({
          where: { id, organizationId, programId },
          data: { sortOrder: index },
        }),
      ),
    );
    await this.syncCurrentChecklists(organizationId, programId);
    return this.listTemplates(organizationId, programId);
  }

  /**
   * Brings every member's checklist for the current month in line with the program's deliverables
   * after staff change them: new names and descriptions, the new order, newly added deliverables,
   * and deliverables turned off removed where nothing was recorded on them yet (anything staff
   * worked on stays, at the end). Statuses, dates, notes and outcomes are never changed. Finalized
   * months and earlier months keep exactly what they had, for the record and final reports; later
   * months are created from the program as it is.
   */
  private async syncCurrentChecklists(organizationId: string, programId: string): Promise<number> {
    const timezone = await this.resolveOrgTimezone(organizationId);
    const { start } = getCalendarPeriodBounds('month', this.now(), timezone);
    const enrollments = await this.prisma.cfProgramEnrollment.findMany({
      where: { organizationId, programId },
      select: { id: true },
    });
    if (!enrollments.length) return 0;
    const cycles = await this.prisma.cfEnrollmentDeliverableCycle.findMany({
      where: {
        organizationId,
        enrollmentId: { in: enrollments.map((enrollment) => enrollment.id) },
        cadence: 'MONTHLY',
        periodStart: start,
        status: 'OPEN',
      },
      select: { id: true, enrollmentId: true },
    });
    if (!cycles.length) return 0;
    const cycleIds = cycles.map((cycle) => cycle.id);
    const templates = await this.prisma.cfProgramDeliverableTemplate.findMany({
      where: { organizationId, programId },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const current = templates.filter((template) => template.active && template.cadence === 'MONTHLY');
    const retiredIds = templates.filter((template) => !current.includes(template)).map((template) => template.id);
    const programDates = await this.programDatesFor(organizationId, programId, start);
    const existing = await this.prisma.cfEnrollmentDeliverable.findMany({
      where: { organizationId, cycleId: { in: cycleIds } },
      select: { id: true, cycleId: true, programDeliverableTemplateId: true, status: true, notes: true, outcome: true },
    });
    const present = new Set(existing.map((row) => `${row.cycleId}:${row.programDeliverableTemplateId}`));
    const untouchedRetired = existing
      .filter((row) => retiredIds.includes(row.programDeliverableTemplateId) && !hasRecordedActivity(row))
      .map((row) => row.id);

    await this.prisma.$transaction(async (transaction) => {
      for (const [index, template] of current.entries()) {
        await transaction.cfEnrollmentDeliverable.updateMany({
          where: { organizationId, cycleId: { in: cycleIds }, programDeliverableTemplateId: template.id },
          data: { titleSnapshot: template.title, descriptionSnapshot: template.description, sortOrder: index },
        });
      }
      const missing = cycles.flatMap((cycle) =>
        current.flatMap((template, index) =>
          present.has(`${cycle.id}:${template.id}`)
            ? []
            : [{
                organizationId,
                cycleId: cycle.id,
                enrollmentId: cycle.enrollmentId,
                programDeliverableTemplateId: template.id,
                titleSnapshot: template.title,
                descriptionSnapshot: template.description,
                sortOrder: index,
                ...(template.programWideDate && programDates.has(template.id)
                  ? { status: 'SCHEDULED' as const, scheduledFor: programDates.get(template.id)! }
                  : { status: 'NOT_STARTED' as const }),
                isNextAction: false,
              }],
        ),
      );
      if (missing.length) await transaction.cfEnrollmentDeliverable.createMany({ data: missing, skipDuplicates: true });
      if (untouchedRetired.length) {
        await transaction.cfEnrollmentDeliverable.deleteMany({ where: { organizationId, id: { in: untouchedRetired } } });
      }
      // Turned-off deliverables someone already worked on stay, after the current ones.
      for (const [offset, templateId] of retiredIds.entries()) {
        await transaction.cfEnrollmentDeliverable.updateMany({
          where: { organizationId, cycleId: { in: cycleIds }, programDeliverableTemplateId: templateId },
          data: { sortOrder: current.length + offset },
        });
      }
    });
    return cycles.length;
  }

  /** A checked "completes automatically when…" setting: a form trigger needs one of this organization's forms. */
  private async autoCompleteSetting(organizationId: string, completeOn: DeliverableTrigger | null, formId: string | null) {
    if (!completeOn) return { completeOn: null, completeOnFormId: null };
    if (completeOn !== 'form_submitted') return { completeOn, completeOnFormId: null };
    if (!formId) throw new BadRequestException('Choose the form that completes this deliverable.');
    const form = await this.prisma.cfFormTemplate.findFirst({ where: { id: formId, organizationId }, select: { id: true } });
    if (!form) throw new BadRequestException('That form was not found. Choose another form.');
    return { completeOn, completeOnFormId: form.id };
  }

  private async requireTemplate(organizationId: string, programId: string, templateId: string) {
    await findProgramForOrg(this.prisma, organizationId, programId);
    const template = await this.prisma.cfProgramDeliverableTemplate.findFirst({
      where: { id: templateId, organizationId, programId },
    });
    if (!template) throw new NotFoundException('Program deliverable not found.');
    return template;
  }

  // ---------------------------------------------------------------------------------------------
  // Program-wide dates
  // ---------------------------------------------------------------------------------------------

  /** The month a "YYYY-MM" names, in the organization's timezone (the same bounds as cycles). */
  private async monthBounds(organizationId: string, month: string) {
    const match = MONTH_PATTERN.exec(month);
    if (!match) throw new BadRequestException('month must look like 2026-10.');
    const timezone = await this.resolveOrgTimezone(organizationId);
    // Mid-month at noon UTC is inside that calendar month in every timezone.
    const reference = new Date(`${month}-15T12:00:00.000Z`);
    const { start, end } = getCalendarPeriodBounds('month', reference, timezone);
    const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: timezone }).format(reference);
    return { start, end, label };
  }

  private async programDatesFor(organizationId: string, programId: string, periodStart: Date) {
    const rows = await this.prisma.cfProgramDeliverableSchedule.findMany({
      where: { organizationId, programId, periodStart },
      select: { templateId: true, scheduledFor: true },
    });
    return new Map(rows.map((row) => [row.templateId, row.scheduledFor]));
  }

  /** The program-wide deliverables and the date each has for `month` (null when not set yet). */
  async listProgramDates(organizationId: string, programId: string, month: string) {
    await findProgramForOrg(this.prisma, organizationId, programId);
    const { start, label } = await this.monthBounds(organizationId, month);
    const templates = await this.prisma.cfProgramDeliverableTemplate.findMany({
      where: { organizationId, programId, programWideDate: true, active: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const dates = await this.programDatesFor(organizationId, programId, start);
    return {
      month,
      label,
      items: templates.map((template) => ({
        templateId: template.id,
        title: template.title,
        scheduledFor: dates.get(template.id) ?? null,
      })),
    };
  }

  /**
   * Sets (or clears) a program-wide deliverable's date for one month and applies it to every
   * member's open checklist for that month. Not-started items become scheduled; other statuses,
   * finalized months and other months are left alone. Clients whose month starts later pick the
   * date up when their checklist is created.
   */
  async setProgramDate(
    organizationId: string,
    programId: string,
    templateId: string,
    dto: SetProgramDeliverableDateDto,
  ) {
    const template = await this.requireTemplate(organizationId, programId, templateId);
    if (!template.programWideDate) {
      throw new BadRequestException(
        `${template.title} is dated per client. Turn on "Same date for everyone" to set it for the program.`,
      );
    }
    const { start, label } = await this.monthBounds(organizationId, dto.month);
    const scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;
    if (dto.scheduledFor && !dto.scheduledFor.startsWith(dto.month)) {
      throw new BadRequestException(`Pick a date in ${label}.`);
    }

    return this.prisma.$transaction(async (transaction) => {
      if (scheduledFor) {
        const existing = await transaction.cfProgramDeliverableSchedule.findFirst({
          where: { organizationId, templateId, periodStart: start },
        });
        if (existing) {
          await transaction.cfProgramDeliverableSchedule.update({
            where: { id: existing.id, organizationId },
            data: { scheduledFor },
          });
        } else {
          await transaction.cfProgramDeliverableSchedule.create({
            data: { organizationId, programId, templateId, periodStart: start, scheduledFor },
          });
        }
      } else {
        await transaction.cfProgramDeliverableSchedule.deleteMany({
          where: { organizationId, templateId, periodStart: start },
        });
      }

      const enrollments = await transaction.cfProgramEnrollment.findMany({
        where: { organizationId, programId },
        select: { id: true },
      });
      const cycles = enrollments.length
        ? await transaction.cfEnrollmentDeliverableCycle.findMany({
            where: {
              organizationId,
              enrollmentId: { in: enrollments.map((enrollment) => enrollment.id) },
              cadence: 'MONTHLY',
              periodStart: start,
              status: 'OPEN',
            },
            select: { id: true },
          })
        : [];
      const cycleIds = cycles.map((cycle) => cycle.id);
      let updated = 0;
      if (cycleIds.length) {
        const where = { organizationId, cycleId: { in: cycleIds }, programDeliverableTemplateId: templateId };
        updated = (await transaction.cfEnrollmentDeliverable.updateMany({ where, data: { scheduledFor } })).count;
        if (scheduledFor) {
          await transaction.cfEnrollmentDeliverable.updateMany({
            where: { ...where, status: 'NOT_STARTED' },
            data: { status: 'SCHEDULED' },
          });
        }
      }
      return { templateId, month: dto.month, label, scheduledFor, clientsUpdated: updated };
    });
  }

  // ---------------------------------------------------------------------------------------------
  // Completing deliverables automatically
  // ---------------------------------------------------------------------------------------------

  /**
   * Something happened for a client (a form submitted, a payment recorded…): every deliverable of
   * their program set to complete on that event is marked completed on their checklist for the
   * month it happened in, with a note saying what completed it. This month's checklist is created
   * when missing; an earlier month only if its checklist is still open; future months never.
   * Items already resolved (done or not applicable) are left alone, so repeating an event changes
   * nothing. Never throws: a problem here must not affect the event that triggered it.
   * Returns how many deliverables were completed.
   */
  async autoComplete(input: {
    organizationId: string;
    enrollmentId: string;
    trigger: DeliverableTrigger;
    /** For form_submitted: the form that was submitted. */
    formId?: string | null;
    /** When it happened (defaults to now); decides which month's checklist it counts for. */
    occurredAt?: Date | null;
    /** What happened, for the note: "Monthly Report form submitted". */
    detail: string;
  }): Promise<number> {
    try {
      const enrollment = await this.prisma.cfProgramEnrollment.findFirst({
        where: { id: input.enrollmentId, organizationId: input.organizationId },
      });
      if (!enrollment) return 0;
      const templates = await this.prisma.cfProgramDeliverableTemplate.findMany({
        where: {
          organizationId: input.organizationId,
          programId: enrollment.programId,
          active: true,
          cadence: 'MONTHLY',
          completeOn: input.trigger,
          ...(input.trigger === 'form_submitted' ? { completeOnFormId: input.formId ?? '__none__' } : {}),
        },
        select: { id: true },
      });
      if (!templates.length) return 0;

      const now = this.now();
      const when = input.occurredAt && !Number.isNaN(input.occurredAt.getTime()) ? input.occurredAt : now;
      const timezone = await this.resolveOrgTimezone(input.organizationId);
      const { start } = getCalendarPeriodBounds('month', when, timezone);
      const current = getCalendarPeriodBounds('month', now, timezone).start;
      if (start.getTime() > current.getTime()) return 0;
      const cycle = start.getTime() === current.getTime()
        ? await this.ensureCycleFor(enrollment, now)
        : await this.prisma.cfEnrollmentDeliverableCycle.findUnique({
            where: { enrollmentId_cadence_periodStart: { enrollmentId: enrollment.id, cadence: 'MONTHLY', periodStart: start } },
          });
      if (!cycle || cycle.status !== 'OPEN') return 0;

      const rows = await this.prisma.cfEnrollmentDeliverable.findMany({
        where: {
          organizationId: input.organizationId,
          cycleId: cycle.id,
          programDeliverableTemplateId: { in: templates.map((template) => template.id) },
        },
      });
      const open = rows.filter((row) => !isResolved(row.status));
      if (!open.length) return 0;
      const note = `Completed automatically: ${input.detail}.`;
      await this.prisma.$transaction(async (transaction) => {
        for (const row of open) {
          // Only a row still open is changed, so two events at once complete it once.
          const changed = await transaction.cfEnrollmentDeliverable.updateMany({
            where: { id: row.id, organizationId: input.organizationId, status: row.status },
            data: {
              status: 'COMPLETED',
              completedAt: when,
              isNextAction: false,
              outcome: row.outcome ? row.outcome : note,
            },
          });
          if (!changed.count) continue;
          await this.logActivity(
            transaction,
            enrollment,
            { id: null, displayName: 'ClientFlow' },
            {
              action: DELIVERABLE_ACTIVITY.autoCompleted,
              description: `${row.titleSnapshot} (${cycle.label}) completed automatically: ${input.detail}.`,
            },
            'automation',
          );
        }
      });
      return open.length;
    } catch (error) {
      this.logger.warn(`Deliverable auto-complete (${input.trigger}) failed: ${error instanceof Error ? error.message : 'unknown error'}`);
      return 0;
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Confirming a deliverable for many members at once (a monthly meeting everyone attended)
  // ---------------------------------------------------------------------------------------------

  /** The month a confirmation is for: this month (checklists are created as needed) or an earlier one. */
  private async confirmationMonth(organizationId: string, month: string) {
    const bounds = await this.monthBounds(organizationId, month);
    const timezone = await this.resolveOrgTimezone(organizationId);
    const current = getCalendarPeriodBounds('month', this.now(), timezone).start;
    if (bounds.start.getTime() > current.getTime()) {
      throw new BadRequestException(`${bounds.label} hasn't started yet.`);
    }
    return { ...bounds, isCurrent: bounds.start.getTime() === current.getTime() };
  }

  /**
   * Every member who could receive this deliverable in `month`, with where they stand: done
   * already, can be confirmed, or why not (finalized month, not active, not on their checklist).
   */
  async listConfirmationMembers(organizationId: string, programId: string, templateId: string, month: string) {
    const template = await this.requireTemplate(organizationId, programId, templateId);
    const { start, label, isCurrent } = await this.confirmationMonth(organizationId, month);
    const enrollments = await this.prisma.cfProgramEnrollment.findMany({
      where: { organizationId, programId, isArchived: false },
      orderBy: { createdAt: 'asc' },
    });
    const enrollmentIds = enrollments.map((enrollment) => enrollment.id);
    const [clients, cycles] = await Promise.all([
      this.prisma.cfClient.findMany({
        where: { organizationId, id: { in: [...new Set(enrollments.map((enrollment) => enrollment.clientId))] }, isArchived: false },
        select: { id: true, businessName: true, primaryContactName: true, isDemo: true },
      }),
      enrollmentIds.length
        ? this.prisma.cfEnrollmentDeliverableCycle.findMany({
            where: { organizationId, enrollmentId: { in: enrollmentIds }, cadence: 'MONTHLY', periodStart: start },
          })
        : Promise.resolve([]),
    ]);
    const rows = cycles.length
      ? await this.prisma.cfEnrollmentDeliverable.findMany({
          where: { organizationId, cycleId: { in: cycles.map((cycle) => cycle.id) }, programDeliverableTemplateId: template.id },
          select: { cycleId: true, status: true },
        })
      : [];
    const clientById = new Map(clients.map((client) => [client.id, client]));
    const cycleByEnrollment = new Map(cycles.map((cycle) => [cycle.enrollmentId, cycle]));
    const rowByCycle = new Map(rows.map((row) => [row.cycleId, row]));
    const members = enrollments.flatMap((enrollment) => {
      const client = clientById.get(enrollment.clientId);
      if (!client) return [];
      const cycle = cycleByEnrollment.get(enrollment.id);
      const row = cycle ? rowByCycle.get(cycle.id) : undefined;
      let blockedReason: 'finalized' | 'not_active' | 'not_on_checklist' | null = null;
      if (cycle?.status === 'FINALIZED') blockedReason = 'finalized';
      else if (cycle && !row) blockedReason = 'not_on_checklist';
      else if (!cycle && !(isCurrent && enrollment.status === 'active' && template.active && template.cadence === 'MONTHLY')) {
        blockedReason = isCurrent && enrollment.status !== 'active' ? 'not_active' : 'not_on_checklist';
      }
      // Members not active and without a checklist this month aren't part of it.
      if (!cycle && enrollment.status !== 'active') return [];
      return [{
        enrollmentId: enrollment.id,
        clientId: client.id,
        businessName: client.businessName,
        contactName: client.primaryContactName,
        isTest: client.isDemo,
        status: row?.status ?? null,
        done: row ? isDone(row.status) : false,
        blockedReason,
      }];
    });
    return { templateId: template.id, title: template.title, month, label, members };
  }

  /**
   * Marks one deliverable completed (or delivered) for the chosen members in one step. This month's
   * checklists are created when missing; earlier months only where a checklist exists. Finalized
   * months, items already done and members it doesn't apply to are left alone and reported.
   */
  async confirmForMembers(
    organizationId: string,
    actor: DeliverableActor,
    programId: string,
    templateId: string,
    dto: ConfirmDeliverableForMembersDto,
  ) {
    const template = await this.requireTemplate(organizationId, programId, templateId);
    const { start, label, isCurrent } = await this.confirmationMonth(organizationId, dto.month);
    const status = dto.status ?? 'COMPLETED';
    const note = optionalText(dto.note) ?? null;
    const wanted = [...new Set(dto.enrollmentIds)];
    if (!wanted.length) throw new BadRequestException('Choose at least one member.');
    const enrollments = await this.prisma.cfProgramEnrollment.findMany({
      where: { organizationId, programId, id: { in: wanted }, isArchived: false },
    });
    if (enrollments.length !== wanted.length) {
      throw new BadRequestException('Some of the chosen members are not in this program. Reload and choose again.');
    }

    const skipped: Array<{ enrollmentId: string; reason: 'finalized' | 'not_on_checklist' }> = [];
    const alreadyDone: string[] = [];
    const toConfirm: Array<{ enrollment: CfProgramEnrollment; deliverable: CfEnrollmentDeliverable }> = [];
    for (const enrollment of enrollments) {
      const cycle = isCurrent
        ? await this.ensureCycleFor(enrollment, this.now())
        : await this.prisma.cfEnrollmentDeliverableCycle.findUnique({
            where: { enrollmentId_cadence_periodStart: { enrollmentId: enrollment.id, cadence: 'MONTHLY', periodStart: start } },
          });
      if (!cycle) {
        skipped.push({ enrollmentId: enrollment.id, reason: 'not_on_checklist' });
        continue;
      }
      if (cycle.status === 'FINALIZED') {
        skipped.push({ enrollmentId: enrollment.id, reason: 'finalized' });
        continue;
      }
      const deliverable = await this.prisma.cfEnrollmentDeliverable.findFirst({
        where: { organizationId, cycleId: cycle.id, programDeliverableTemplateId: template.id },
      });
      if (!deliverable) skipped.push({ enrollmentId: enrollment.id, reason: 'not_on_checklist' });
      else if (isDone(deliverable.status)) alreadyDone.push(enrollment.id);
      else toConfirm.push({ enrollment, deliverable });
    }

    const completedAt = this.now();
    await this.prisma.$transaction(async (transaction) => {
      for (const { enrollment, deliverable } of toConfirm) {
        await transaction.cfEnrollmentDeliverable.update({
          where: { id: deliverable.id, organizationId },
          data: {
            status,
            completedAt,
            isNextAction: false,
            ...(note ? { notes: deliverable.notes ? `${deliverable.notes}\n${note}` : note } : {}),
          },
        });
        await this.logActivity(transaction, enrollment, actor, {
          action: DELIVERABLE_ACTIVITY.completed,
          description: `${deliverable.titleSnapshot} (${label}): ${STATUS_LABELS[deliverable.status]} → ${STATUS_LABELS[status]}. Confirmed for ${toConfirm.length} member${toConfirm.length === 1 ? '' : 's'}${note ? ` — ${note}` : ''}.`,
        });
      }
    });
    return {
      templateId: template.id,
      month: dto.month,
      label,
      confirmed: toConfirm.map(({ enrollment }) => enrollment.id),
      alreadyDone,
      skipped,
    };
  }

  // ---------------------------------------------------------------------------------------------
  // Enrollment cycles
  // ---------------------------------------------------------------------------------------------

  /**
   * The enrollment's cycle for the period containing `now`, created on first use. Idempotent and
   * safe to call concurrently: the cycle and its deliverables are created together in one
   * transaction, and the (enrollment, cadence, period) unique key lets only one caller create it.
   * An existing cycle is returned as is, whatever the program's configuration is now.
   *
   * Returns null when there is no cycle for this period and none should be created (the enrollment
   * isn't active, or the program has no active monthly deliverables).
   */
  async ensureCurrentCycle(organizationId: string, enrollmentId: string, now: Date = new Date()) {
    const enrollment = await findEnrollmentForOrg(this.prisma, organizationId, enrollmentId);
    return this.ensureCycleFor(enrollment, now);
  }

  private async ensureCycleFor(enrollment: CfProgramEnrollment, now: Date) {
    const timezone = await this.resolveOrgTimezone(enrollment.organizationId);
    const { start, end } = getCalendarPeriodBounds('month', now, timezone);
    const key = { enrollmentId: enrollment.id, cadence: 'MONTHLY' as const, periodStart: start };
    const existing = await this.prisma.cfEnrollmentDeliverableCycle.findUnique({
      where: { enrollmentId_cadence_periodStart: key },
    });
    if (existing) return existing;
    if (enrollment.status !== 'active' || enrollment.isArchived) return null;

    const templates = await this.prisma.cfProgramDeliverableTemplate.findMany({
      where: { organizationId: enrollment.organizationId, programId: enrollment.programId, active: true, cadence: 'MONTHLY' },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    if (templates.length === 0) return null;

    const label = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: timezone }).format(now);
    // Dates the program already set for this month (an event everyone attends) start on the checklist.
    const programDates = await this.programDatesFor(enrollment.organizationId, enrollment.programId, start);
    try {
      return await this.prisma.$transaction(async (transaction) => {
        const cycle = await transaction.cfEnrollmentDeliverableCycle.create({
          data: {
            organizationId: enrollment.organizationId,
            enrollmentId: enrollment.id,
            cadence: 'MONTHLY',
            periodStart: start,
            periodEnd: end,
            label,
            status: 'OPEN',
          },
        });
        await transaction.cfEnrollmentDeliverable.createMany({
          data: templates.map((template, index) => ({
            organizationId: enrollment.organizationId,
            cycleId: cycle.id,
            enrollmentId: enrollment.id,
            programDeliverableTemplateId: template.id,
            titleSnapshot: template.title,
            descriptionSnapshot: template.description,
            sortOrder: index,
            ...(template.programWideDate && programDates.has(template.id)
              ? { status: 'SCHEDULED' as const, scheduledFor: programDates.get(template.id)! }
              : { status: 'NOT_STARTED' as const }),
            isNextAction: false,
          })),
          skipDuplicates: true,
        });
        return cycle;
      });
    } catch (error) {
      // Another request created this period's cycle first; theirs (with its deliverables) wins.
      if (!isUniqueViolation(error)) throw error;
      const created = await this.prisma.cfEnrollmentDeliverableCycle.findUnique({
        where: { enrollmentId_cadence_periodStart: key },
      });
      if (!created) throw error;
      return created;
    }
  }

  async getCurrent(organizationId: string, enrollmentId: string, now: Date = new Date()): Promise<CurrentCycleView> {
    const enrollment = await findEnrollmentForOrg(this.prisma, organizationId, enrollmentId);
    const cycle = await this.ensureCycleFor(enrollment, now);
    if (cycle) return { ...(await this.viewOf(cycle)), reason: null };
    const configured = await this.prisma.cfProgramDeliverableTemplate.count({
      where: { organizationId, programId: enrollment.programId, active: true },
    });
    return {
      cycle: null,
      items: [],
      summary: EMPTY_SUMMARY,
      nextAction: null,
      reason: configured === 0 ? 'no_deliverables_configured' : 'enrollment_not_active',
    };
  }

  /** Every cycle of the enrollment, newest first, with its counts. */
  async listHistory(organizationId: string, enrollmentId: string) {
    await findEnrollmentForOrg(this.prisma, organizationId, enrollmentId);
    const cycles = await this.prisma.cfEnrollmentDeliverableCycle.findMany({
      where: { organizationId, enrollmentId },
      orderBy: { periodStart: 'desc' },
    });
    const items = cycles.length
      ? await this.prisma.cfEnrollmentDeliverable.findMany({
          where: { organizationId, enrollmentId, cycleId: { in: cycles.map((cycle) => cycle.id) } },
          select: { cycleId: true, status: true, notes: true, outcome: true },
        })
      : [];
    return cycles.map((cycle) => ({
      ...cycle,
      summary: summarizeDeliverables(items.filter((item) => item.cycleId === cycle.id)),
    }));
  }

  /**
   * Each member's next action from their newest checklist (the same month the Overview shows),
   * for the program's member list.
   * Read-only: never creates a checklist. Members without one are left out.
   */
  async listNextActions(organizationId: string, programId: string): Promise<Record<string, MemberNextAction>> {
    await findProgramForOrg(this.prisma, organizationId, programId);
    const enrollments = await this.prisma.cfProgramEnrollment.findMany({
      where: { organizationId, programId },
      select: { id: true },
    });
    if (!enrollments.length) return {};
    const cycles = await this.prisma.cfEnrollmentDeliverableCycle.findMany({
      where: { organizationId, enrollmentId: { in: enrollments.map((enrollment) => enrollment.id) } },
      orderBy: { periodStart: 'desc' },
    });
    const newest = new Map<string, CfEnrollmentDeliverableCycle>();
    for (const cycle of cycles) if (!newest.has(cycle.enrollmentId)) newest.set(cycle.enrollmentId, cycle);
    if (!newest.size) return {};
    const items = await this.prisma.cfEnrollmentDeliverable.findMany({
      where: { organizationId, cycleId: { in: [...newest.values()].map((cycle) => cycle.id) } },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const result: Record<string, MemberNextAction> = {};
    for (const [enrollmentId, cycle] of newest) {
      const own = items.filter((item) => item.cycleId === cycle.id);
      const summary = summarizeDeliverables(own);
      const next = selectNextAction(own);
      result[enrollmentId] = {
        cycleLabel: cycle.label,
        title: next?.titleSnapshot ?? null,
        status: next?.status ?? null,
        scheduledFor: next?.scheduledFor ?? null,
        delivered: summary.deliveredOrCompleted,
        total: summary.total,
        allResolved: summary.total > 0 && summary.open === 0,
      };
    }
    return result;
  }

  /**
   * The enrollment's whole program history for the Final Report: what the client asked for, and
   * every month's deliverables oldest first. Read straight from the stored checklists, so the report
   * never holds a second copy of them.
   */
  async getProgramHistory(organizationId: string, enrollmentId: string, now: Date = new Date()): Promise<ProgramHistory> {
    const enrollment = await findEnrollmentForOrg(this.prisma, organizationId, enrollmentId);
    const client = await this.prisma.cfClient.findFirst({
      where: { id: enrollment.clientId, organizationId },
      select: { intake: true },
    });
    const intake = client?.intake && typeof client.intake === 'object' && !Array.isArray(client.intake)
      ? (client.intake as Record<string, unknown>)
      : {};
    const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
    const cycles = await this.prisma.cfEnrollmentDeliverableCycle.findMany({
      where: { organizationId, enrollmentId },
      orderBy: { periodStart: 'asc' },
    });
    const items = cycles.length
      ? await this.prisma.cfEnrollmentDeliverable.findMany({
          where: { organizationId, enrollmentId, cycleId: { in: cycles.map((cycle) => cycle.id) } },
          orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        })
      : [];
    const recordedMonths: ProgramHistory['months'] = cycles.map((cycle) => {
      const own = items.filter((item) => item.cycleId === cycle.id);
      return {
        cycleId: cycle.id,
        recorded: true,
        label: cycle.label,
        periodStart: cycle.periodStart,
        periodEnd: cycle.periodEnd,
        status: cycle.status,
        finalizedAt: cycle.finalizedAt,
        summary: summarizeDeliverables(own),
        items: own.map((item) => ({
          id: item.id,
          title: item.titleSnapshot,
          status: item.status,
          scheduledFor: item.scheduledFor,
          completedAt: item.completedAt,
          outcome: item.outcome,
          notes: item.notes,
        })),
      };
    });
    const endedAt = enrollment.completedAt ?? enrollment.withdrawnAt ?? null;
    const months = cycles.length
      ? await this.withUnrecordedMonths(organizationId, recordedMonths, endedAt && endedAt < now ? endedAt : now)
      : [];
    return {
      enrollmentId: enrollment.id,
      programId: enrollment.programId,
      joinedAt: enrollment.startDate ?? null,
      endedAt,
      originalRequest: {
        assistanceRequested: text(intake.assistanceRequested),
        budgetNeed: text(intake.budgetNeed),
      },
      months,
    };
  }

  /**
   * Inserts the months between the first checklist and `until` that have no checklist, in the
   * organization's timezone, so a month with nothing recorded shows as such instead of vanishing.
   */
  private async withUnrecordedMonths(
    organizationId: string,
    recorded: ProgramHistory['months'],
    until: Date,
  ): Promise<ProgramHistory['months']> {
    const timezone = await this.resolveOrgTimezone(organizationId);
    const byStart = new Map(recorded.map((month) => [month.periodStart.getTime(), month]));
    const lastStart = getCalendarPeriodBounds('month', until, timezone).start.getTime();
    const result: ProgramHistory['months'] = [];
    let bounds = getCalendarPeriodBounds('month', recorded[0].periodStart, timezone);
    // Bounded: one entry per month, so a very old first record still stops at `until`.
    for (let guard = 0; guard < 600 && bounds.start.getTime() <= lastStart; guard += 1) {
      const existing = byStart.get(bounds.start.getTime());
      result.push(
        existing ?? {
          cycleId: null,
          recorded: false,
          label: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric', timeZone: timezone }).format(bounds.start),
          periodStart: bounds.start,
          periodEnd: bounds.end,
          status: null,
          finalizedAt: null,
          summary: EMPTY_SUMMARY,
          items: [],
        },
      );
      bounds = getCalendarPeriodBounds('month', new Date(bounds.end.getTime() + 1), timezone);
    }
    // Any record outside the computed range (e.g. a timezone change) is still shown, never dropped.
    for (const month of recorded) if (!result.includes(month)) result.push(month);
    return result.sort((a, b) => a.periodStart.getTime() - b.periodStart.getTime());
  }

  async getCycle(organizationId: string, enrollmentId: string, cycleId: string): Promise<CycleView> {
    await findEnrollmentForOrg(this.prisma, organizationId, enrollmentId);
    return this.viewOf(await this.requireCycle(this.prisma, organizationId, enrollmentId, cycleId));
  }

  private async viewOf(cycle: CfEnrollmentDeliverableCycle): Promise<CycleView> {
    const rows = await this.prisma.cfEnrollmentDeliverable.findMany({
      where: { organizationId: cycle.organizationId, cycleId: cycle.id },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    const programWide = new Set(
      (
        await this.prisma.cfProgramDeliverableTemplate.findMany({
          where: {
            organizationId: cycle.organizationId,
            id: { in: rows.map((row) => row.programDeliverableTemplateId) },
            programWideDate: true,
          },
          select: { id: true },
        })
      ).map((template) => template.id),
    );
    const items = rows.map((row) => ({ ...row, dateSetByProgram: programWide.has(row.programDeliverableTemplateId) }));
    return { cycle, items, summary: summarizeDeliverables(items), nextAction: selectNextAction(items) };
  }

  private async requireCycle(db: TenantDb, organizationId: string, enrollmentId: string, cycleId: string) {
    const cycle = await db.cfEnrollmentDeliverableCycle.findFirst({ where: { id: cycleId, organizationId, enrollmentId } });
    if (!cycle) throw new NotFoundException('Reporting period not found.');
    return cycle;
  }

  /** The deliverable and its cycle, refusing changes once the cycle is finalized. */
  private async requireEditable(db: TenantDb, organizationId: string, enrollmentId: string, deliverableId: string) {
    const deliverable = await db.cfEnrollmentDeliverable.findFirst({
      where: { id: deliverableId, organizationId, enrollmentId },
    });
    if (!deliverable) throw new NotFoundException('Program deliverable not found.');
    const cycle = await this.requireCycle(db, organizationId, enrollmentId, deliverable.cycleId);
    if (cycle.status === 'FINALIZED') {
      throw new ConflictException(`${cycle.label} is finalized and can no longer be changed.`);
    }
    return { deliverable, cycle };
  }

  // ---------------------------------------------------------------------------------------------
  // Client deliverables
  // ---------------------------------------------------------------------------------------------

  async updateDeliverable(
    organizationId: string,
    actor: DeliverableActor,
    enrollmentId: string,
    deliverableId: string,
    dto: UpdateEnrollmentDeliverableDto,
  ) {
    const enrollment = await findEnrollmentForOrg(this.prisma, organizationId, enrollmentId);
    const { deliverable, cycle } = await this.requireEditable(this.prisma, organizationId, enrollmentId, deliverableId);

    if (dto.scheduledFor !== undefined) {
      const template = await this.prisma.cfProgramDeliverableTemplate.findFirst({
        where: { id: deliverable.programDeliverableTemplateId, organizationId },
        select: { programWideDate: true },
      });
      if (template?.programWideDate) {
        throw new ConflictException(
          `The date for ${deliverable.titleSnapshot} is set for the whole program in Programs › Deliverables.`,
        );
      }
    }

    const previousStatus = deliverable.status;
    const data: Prisma.CfEnrollmentDeliverableUpdateInput = {};
    const statusChanged = dto.status !== undefined && dto.status !== deliverable.status;
    if (dto.status !== undefined) {
      data.status = dto.status;
      if (isDone(dto.status)) {
        data.completedAt = deliverable.completedAt ?? new Date();
      } else {
        data.completedAt = null;
      }
      // Something finished (or not applicable) can't stay the next action.
      if (isResolved(dto.status)) data.isNextAction = false;
    }
    if (dto.scheduledFor !== undefined) data.scheduledFor = dto.scheduledFor ? new Date(dto.scheduledFor) : null;
    if (dto.notes !== undefined) data.notes = optionalText(dto.notes);
    if (dto.outcome !== undefined) data.outcome = optionalText(dto.outcome);
    if (dto.isNextAction === false) data.isNextAction = false;

    return this.prisma.$transaction(async (transaction) => {
      const updated = await transaction.cfEnrollmentDeliverable.update({ where: { id: deliverable.id, organizationId }, data });
      if (statusChanged && dto.status) {
        await this.logActivity(transaction, enrollment, actor, {
          action: isDone(dto.status) ? DELIVERABLE_ACTIVITY.completed : DELIVERABLE_ACTIVITY.statusChanged,
          description: `${deliverable.titleSnapshot} (${cycle.label}): ${STATUS_LABELS[previousStatus]} → ${STATUS_LABELS[dto.status]}.`,
        });
      }
      return updated;
    });
  }

  /** Marks one deliverable as the next action, clearing any other mark in the same cycle. */
  async setNextAction(organizationId: string, actor: DeliverableActor, enrollmentId: string, deliverableId: string) {
    const enrollment = await findEnrollmentForOrg(this.prisma, organizationId, enrollmentId);
    return this.prisma.$transaction(async (transaction) => {
      const { deliverable, cycle } = await this.requireEditable(transaction, organizationId, enrollmentId, deliverableId);
      if (isResolved(deliverable.status)) {
        throw new BadRequestException('A delivered, completed or not applicable deliverable cannot be the next action.');
      }
      const alreadyNextAction = deliverable.isNextAction;
      await transaction.cfEnrollmentDeliverable.updateMany({
        where: { organizationId, cycleId: cycle.id, isNextAction: true, id: { not: deliverable.id } },
        data: { isNextAction: false },
      });
      const updated = await transaction.cfEnrollmentDeliverable.update({
        where: { id: deliverable.id, organizationId },
        data: { isNextAction: true },
      });
      if (!alreadyNextAction) {
        await this.logActivity(transaction, enrollment, actor, {
          action: DELIVERABLE_ACTIVITY.nextActionSet,
          description: `Next program action set to ${deliverable.titleSnapshot} (${cycle.label}).`,
        });
      }
      return updated;
    });
  }

  /** Finalizing makes the cycle read-only; it is never reopened or overwritten. */
  async finalizeCycle(organizationId: string, actor: DeliverableActor, enrollmentId: string, cycleId: string) {
    const enrollment = await findEnrollmentForOrg(this.prisma, organizationId, enrollmentId);
    const cycle = await this.requireCycle(this.prisma, organizationId, enrollmentId, cycleId);
    return this.prisma.$transaction(async (transaction) => {
      const result = await transaction.cfEnrollmentDeliverableCycle.updateMany({
        where: { id: cycle.id, organizationId, enrollmentId, status: 'OPEN' },
        data: {
          status: 'FINALIZED',
          finalizedAt: new Date(),
          finalizedByUserId: actor.id,
          finalizedByDisplayName: actor.displayName,
        },
      });
      if (result.count !== 1) throw new ConflictException(`${cycle.label} is already finalized.`);
      await this.logActivity(transaction, enrollment, actor, {
        action: DELIVERABLE_ACTIVITY.cycleFinalized,
        description: `${cycle.label} program deliverables finalized.`,
      });
      return transaction.cfEnrollmentDeliverableCycle.findFirstOrThrow({ where: { id: cycle.id, organizationId } });
    });
  }

  // ---------------------------------------------------------------------------------------------

  private async logActivity(
    db: TenantDb,
    enrollment: CfProgramEnrollment,
    actor: DeliverableActor,
    entry: { action: string; description: string },
    source: 'manual_staff_action' | 'automation' = 'manual_staff_action',
  ) {
    await db.cfActivityLog.create({
      data: {
        organizationId: enrollment.organizationId,
        clientId: enrollment.clientId,
        enrollmentId: enrollment.id,
        actorUserId: actor.id,
        action: entry.action,
        description: entry.description,
        user: actor.displayName,
        source,
        isDemo: enrollment.isDemo,
      },
    });
  }

  private async resolveOrgTimezone(organizationId: string): Promise<string> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
      select: { settings: true },
    });
    const settings =
      organization?.settings && typeof organization.settings === 'object'
        ? (organization.settings as Record<string, unknown>)
        : {};
    return typeof settings.timezone === 'string' && isValidTimezone(settings.timezone) ? settings.timezone : 'UTC';
  }
}
