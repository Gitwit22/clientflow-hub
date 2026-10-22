import type { CfDeliverableStatus } from '../../generated/clientflow';

/** Delivered or completed: what the program actually provided this period. */
export const DONE_STATUSES: readonly CfDeliverableStatus[] = ['DELIVERED', 'COMPLETED'];
/** Nothing left to do this period. NOT_APPLICABLE is resolved but never counted as delivered. */
export const RESOLVED_STATUSES: readonly CfDeliverableStatus[] = ['DELIVERED', 'COMPLETED', 'NOT_APPLICABLE'];

export const isDone = (status: CfDeliverableStatus) => DONE_STATUSES.includes(status);
export const isResolved = (status: CfDeliverableStatus) => RESOLVED_STATUSES.includes(status);

export interface DeliverableSummary {
  total: number;
  /** DELIVERED + COMPLETED. */
  deliveredOrCompleted: number;
  available: number;
  notApplicable: number;
  /** Everything not yet resolved (including AVAILABLE). */
  open: number;
  /**
   * Items staff recorded something on: any status past "not started"/"scheduled", or a note or
   * outcome. 0 means nothing was recorded that period, which is not the same as work falling short.
   */
  withActivity: number;
}

/** Statuses that only describe a plan (a date may come from the program), not work recorded. */
const PLANNED_ONLY: readonly CfDeliverableStatus[] = ['NOT_STARTED', 'SCHEDULED'];

/** Whether staff recorded anything on this item. */
export function hasRecordedActivity(item: { status: CfDeliverableStatus; notes?: string | null; outcome?: string | null }): boolean {
  return !PLANNED_ONLY.includes(item.status) || Boolean(item.notes?.trim()) || Boolean(item.outcome?.trim());
}

export function summarizeDeliverables(
  items: readonly { status: CfDeliverableStatus; notes?: string | null; outcome?: string | null }[],
): DeliverableSummary {
  const count = (predicate: (status: CfDeliverableStatus) => boolean) =>
    items.filter((item) => predicate(item.status)).length;
  return {
    total: items.length,
    deliveredOrCompleted: count(isDone),
    available: count((status) => status === 'AVAILABLE'),
    notApplicable: count((status) => status === 'NOT_APPLICABLE'),
    open: count((status) => !isResolved(status)),
    withActivity: items.filter(hasRecordedActivity).length,
  };
}

/**
 * The one deliverable shown as the enrollment's next action. Worked out from the deliverables,
 * so staff never maintain a separate "next action":
 * 1. the item staff explicitly marked, while it is unresolved;
 * 2. otherwise the unresolved item with the earliest date (an overdue one first);
 * 3. otherwise the first item in progress;
 * 4. otherwise the first other unresolved item (available or not started);
 * 5. otherwise none: everything this period is resolved.
 * Ties follow the program's order.
 */
export function selectNextAction<
  T extends { status: CfDeliverableStatus; isNextAction: boolean; scheduledFor: Date | null; sortOrder: number },
>(items: readonly T[]): T | null {
  const unresolved = [...items.filter((item) => !isResolved(item.status))].sort((a, b) => a.sortOrder - b.sortOrder);
  const explicit = unresolved.find((item) => item.isNextAction);
  if (explicit) return explicit;
  const scheduled = unresolved
    .filter((item) => item.scheduledFor)
    .sort((a, b) => a.scheduledFor!.getTime() - b.scheduledFor!.getTime() || a.sortOrder - b.sortOrder);
  if (scheduled[0]) return scheduled[0];
  return unresolved.find((item) => item.status === 'IN_PROGRESS') ?? unresolved[0] ?? null;
}
