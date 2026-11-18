import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { CfDeliverableStatus, Prisma } from '../../generated/clientflow';
import { isResolved } from './deliverable-summary';

/**
 * Merges one of a program's deliverables into another when they turn out to be the same thing
 * (e.g. "IDI Member Fund Opportunities" into "LIVE Grant Giveaway"):
 * - notes and outcomes recorded on the merged deliverable are added to the other deliverable's
 *   item for the same month, labelled with where they came from;
 * - the merged deliverable's open items are marked not applicable (finished ones keep their status),
 *   and every item keeps its own history with a "Merged into …" note;
 * - the merged deliverable is turned off, so it is on no new month's checklist.
 * Running it again changes nothing (items already merged are recognised by their note).
 */
export interface DeliverableMergeReport {
  applied: boolean;
  from: { id: string; title: string };
  into: { id: string; title: string };
  /** Items of the merged deliverable, across every client and month. */
  items: number;
  /** Items whose notes were added to the other deliverable's item for the same month. */
  notesMoved: number;
  /** Items with notes but no item of the other deliverable that month: their notes stay on them. */
  notesKeptInPlace: number;
  /** Open items marked not applicable. */
  closed: number;
  /** Items merged by an earlier run. */
  alreadyMerged: number;
  /** Whether the merged deliverable was still on and is turned off. */
  turnedOff: boolean;
}

type Db = Pick<Prisma.TransactionClient, 'cfProgramDeliverableTemplate' | 'cfEnrollmentDeliverable'>;

export const mergedMarker = (intoTitle: string) => `Merged into “${intoTitle}”.`;

const withNote = (existing: string | null, addition: string) =>
  existing && existing.trim() ? `${existing.trimEnd()}\n\n${addition}` : addition;

export async function mergeDeliverables(
  db: Db,
  organizationId: string,
  programId: string,
  fromTemplateId: string,
  intoTemplateId: string,
  apply: boolean,
): Promise<DeliverableMergeReport> {
  if (fromTemplateId === intoTemplateId) {
    throw new BadRequestException('Choose a different deliverable to merge into.');
  }
  const [from, into] = await Promise.all([
    db.cfProgramDeliverableTemplate.findFirst({ where: { id: fromTemplateId, organizationId, programId } }),
    db.cfProgramDeliverableTemplate.findFirst({ where: { id: intoTemplateId, organizationId, programId } }),
  ]);
  if (!from || !into) throw new NotFoundException('Deliverable not found in this program.');
  if (!into.active) throw new BadRequestException(`“${into.title}” is turned off. Merge into a deliverable that is on.`);

  const marker = mergedMarker(into.title);
  const items = await db.cfEnrollmentDeliverable.findMany({
    where: { organizationId, programDeliverableTemplateId: from.id },
    orderBy: [{ cycleId: 'asc' }],
  });
  const targets = items.length
    ? await db.cfEnrollmentDeliverable.findMany({
        where: { organizationId, programDeliverableTemplateId: into.id, cycleId: { in: [...new Set(items.map((item) => item.cycleId))] } },
      })
    : [];
  const targetByCycle = new Map(targets.map((target) => [target.cycleId, target]));

  const report: DeliverableMergeReport = {
    applied: apply,
    from: { id: from.id, title: from.title },
    into: { id: into.id, title: into.title },
    items: items.length,
    notesMoved: 0,
    notesKeptInPlace: 0,
    closed: 0,
    alreadyMerged: 0,
    turnedOff: from.active,
  };

  for (const item of items) {
    if (item.notes?.includes(marker)) {
      report.alreadyMerged += 1;
      continue;
    }
    const recorded = [item.notes, item.outcome].map((text) => text?.trim()).filter(Boolean).join(' — ');
    const target = targetByCycle.get(item.cycleId);
    if (recorded && target) {
      report.notesMoved += 1;
      const addition = `From “${from.title}”: ${recorded}`;
      if (apply) {
        target.notes = withNote(target.notes, addition);
        await db.cfEnrollmentDeliverable.update({ where: { id: target.id }, data: { notes: target.notes } });
      }
    } else if (recorded) {
      report.notesKeptInPlace += 1;
    }
    const status: CfDeliverableStatus = isResolved(item.status) ? item.status : 'NOT_APPLICABLE';
    if (status !== item.status) report.closed += 1;
    if (apply) {
      await db.cfEnrollmentDeliverable.update({
        where: { id: item.id },
        data: { status, notes: withNote(item.notes, marker), isNextAction: false },
      });
    }
  }

  if (apply && from.active) {
    await db.cfProgramDeliverableTemplate.update({ where: { id: from.id }, data: { active: false } });
  }
  return report;
}
