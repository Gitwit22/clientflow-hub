import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type {
  CfDeliverableStatus,
  CfEnrollmentDeliverable,
  CfEnrollmentDeliverableCycle,
  CfProgramEnrollment,
  Prisma,
} from '../../generated/clientflow';
import { findEnrollmentForOrg, findProgramForOrg, type TenantDb } from '../../common/tenancy/org-scoped.repository';
import { PrismaService } from '../../prisma/prisma.service';
import { getCalendarPeriodBounds } from '../billing/billing-schedule.util';
import { isUniqueViolation } from '../communications/communication-attempts';
import {
  isDone,
  isResolved,
  selectNextAction,
  summarizeDeliverables,
  type DeliverableSummary,
} from './deliverable-summary';
import type {
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

export const DELIVERABLE_ACTIVITY = {
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

const EMPTY_SUMMARY: DeliverableSummary = { total: 0, deliveredOrCompleted: 0, available: 0, notApplicable: 0, open: 0 };

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
  constructor(private readonly prisma: PrismaService) {}

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
    return this.prisma.cfProgramDeliverableTemplate.create({
      data: {
        organizationId,
        programId,
        title,
        description: optionalText(dto.description) ?? null,
        cadence: dto.cadence ?? 'MONTHLY',
        active: dto.active ?? true,
        programWideDate: dto.programWideDate ?? false,
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
    });
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
    return this.prisma.cfProgramDeliverableTemplate.update({ where: { id: templateId, organizationId }, data });
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
    return this.listTemplates(organizationId, programId);
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
          select: { cycleId: true, status: true },
        })
      : [];
    return cycles.map((cycle) => ({
      ...cycle,
      summary: summarizeDeliverables(items.filter((item) => item.cycleId === cycle.id)),
    }));
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
        source: 'manual_staff_action',
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
