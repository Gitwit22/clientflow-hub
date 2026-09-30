import { isTerminalEnrollmentStatus } from "@/lib/enrollment-status";

export type MonitoringBucket = "overdue" | "today" | "week" | "upcoming" | "unscheduled" | "done";

interface BucketItem {
  active: boolean;
  nextReviewAt?: string | null;
  lastReviewedAt?: string | null;
}

const DAY_MS = 86_400_000;

function startOfDay(time: number): number {
  const date = new Date(time);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Where a monitoring item belongs on the board, by calendar day in the viewer's timezone. Every item
 * lands in exactly one bucket: overdue (due before today), today, this week (the next 7 days),
 * upcoming (later), unscheduled (active with no next review), done (inactive, or reviewed with no
 * further review due).
 */
export function monitoringBucket(item: BucketItem, now = Date.now()): MonitoringBucket {
  if (!item.active) return "done";
  if (!item.nextReviewAt) return item.lastReviewedAt ? "done" : "unscheduled";
  const due = new Date(item.nextReviewAt).getTime();
  const today = startOfDay(now);
  if (due < today) return "overdue";
  if (due < today + DAY_MS) return "today";
  if (due < today + 8 * DAY_MS) return "week";
  return "upcoming";
}

/** Monitoring that still applies: its enrollment exists, is open and isn't archived. */
export function isLiveMonitoring(
  item: { enrollmentId: string },
  enrollments: readonly { id: string; status: string; isArchived?: boolean }[],
): boolean {
  const enrollment = enrollments.find((candidate) => candidate.id === item.enrollmentId);
  return Boolean(
    enrollment && !enrollment.isArchived && !isTerminalEnrollmentStatus(enrollment.status),
  );
}
