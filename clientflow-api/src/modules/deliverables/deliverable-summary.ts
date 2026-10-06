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
}

export function summarizeDeliverables(items: readonly { status: CfDeliverableStatus }[]): DeliverableSummary {
  const count = (predicate: (status: CfDeliverableStatus) => boolean) =>
    items.filter((item) => predicate(item.status)).length;
  return {
    total: items.length,
    deliveredOrCompleted: count(isDone),
    available: count((status) => status === 'AVAILABLE'),
    notApplicable: count((status) => status === 'NOT_APPLICABLE'),
    open: count((status) => !isResolved(status)),
  };
}

/**
 * The one deliverable shown as the enrollment's next program action:
 * 1. the item staff explicitly marked, while it is unresolved;
 * 2. otherwise the unresolved item with the earliest scheduled date (an overdue one included);
 * 3. otherwise none. An unscheduled item is never picked on its own.
 */
export function selectNextAction<
  T extends { status: CfDeliverableStatus; isNextAction: boolean; scheduledFor: Date | null; sortOrder: number },
>(items: readonly T[]): T | null {
  const unresolved = items.filter((item) => !isResolved(item.status));
  const explicit = unresolved.find((item) => item.isNextAction);
  if (explicit) return explicit;
  const scheduled = unresolved
    .filter((item) => item.scheduledFor)
    .sort((a, b) => a.scheduledFor!.getTime() - b.scheduledFor!.getTime() || a.sortOrder - b.sortOrder);
  return scheduled[0] ?? null;
}
