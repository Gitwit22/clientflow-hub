/** Program Deliverables: what a program promises its clients each period, tracked per enrollment. */

export type DeliverableCadence = "MONTHLY" | "QUARTERLY" | "ONE_TIME" | "AS_NEEDED";
export type DeliverableStatus =
  | "NOT_STARTED"
  | "AVAILABLE"
  | "SCHEDULED"
  | "IN_PROGRESS"
  | "DELIVERED"
  | "COMPLETED"
  | "NOT_APPLICABLE";

export interface ProgramDeliverableTemplate {
  id: string;
  programId: string;
  title: string;
  description: string | null;
  cadence: DeliverableCadence;
  active: boolean;
  sortOrder: number;
  /** The date is set once per month for the whole program instead of per client. */
  programWideDate: boolean;
}

export interface DeliverableCycle {
  id: string;
  enrollmentId: string;
  cadence: DeliverableCadence;
  periodStart: string;
  periodEnd: string;
  label: string;
  status: "OPEN" | "FINALIZED";
  finalizedAt: string | null;
  finalizedByDisplayName: string | null;
}

export interface EnrollmentDeliverable {
  id: string;
  cycleId: string;
  enrollmentId: string;
  titleSnapshot: string;
  descriptionSnapshot: string | null;
  sortOrder: number;
  status: DeliverableStatus;
  scheduledFor: string | null;
  completedAt: string | null;
  notes: string | null;
  outcome: string | null;
  isNextAction: boolean;
  /** The date comes from the program (same for every member) and can't be changed per client. */
  dateSetByProgram?: boolean;
}

export interface DeliverableSummary {
  total: number;
  deliveredOrCompleted: number;
  available: number;
  notApplicable: number;
  open: number;
}

export interface DeliverableCycleView {
  cycle: DeliverableCycle | null;
  items: EnrollmentDeliverable[];
  summary: DeliverableSummary;
  nextAction: EnrollmentDeliverable | null;
  reason?: "no_deliverables_configured" | "enrollment_not_active" | null;
}

export type DeliverableCycleHistoryEntry = DeliverableCycle & { summary: DeliverableSummary };

/** One member's next action, from their current checklist (program member list). */
export interface MemberNextAction {
  cycleLabel: string;
  title: string | null;
  status: DeliverableStatus | null;
  scheduledFor: string | null;
  delivered: number;
  total: number;
  /** Every deliverable this period is delivered, completed or not applicable. */
  allResolved: boolean;
}

/** An enrollment's whole program history, for the Final Report. */
export interface ProgramHistory {
  enrollmentId: string;
  programId: string;
  joinedAt: string | null;
  endedAt: string | null;
  originalRequest: { assistanceRequested: string | null; budgetNeed: string | null };
  months: {
    cycleId: string;
    label: string;
    periodStart: string;
    periodEnd: string;
    status: "OPEN" | "FINALIZED";
    finalizedAt: string | null;
    summary: DeliverableSummary;
    items: {
      id: string;
      title: string;
      status: DeliverableStatus;
      scheduledFor: string | null;
      completedAt: string | null;
      outcome: string | null;
    }[];
  }[];
}

export interface ProgramDeliverableDates {
  month: string;
  label: string;
  items: { templateId: string; title: string; scheduledFor: string | null }[];
}

export const CADENCE_LABELS: Record<DeliverableCadence, string> = {
  MONTHLY: "Monthly",
  QUARTERLY: "Quarterly",
  ONE_TIME: "One time",
  AS_NEEDED: "As needed",
};

export const DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string> = {
  NOT_STARTED: "Not started",
  AVAILABLE: "Available",
  SCHEDULED: "Scheduled",
  IN_PROGRESS: "In progress",
  DELIVERED: "Delivered",
  COMPLETED: "Completed",
  NOT_APPLICABLE: "Not applicable",
};

export const DELIVERABLE_STATUSES = Object.keys(DELIVERABLE_STATUS_LABELS) as DeliverableStatus[];

export const isDoneStatus = (status: DeliverableStatus) =>
  status === "DELIVERED" || status === "COMPLETED";
export const isResolvedStatus = (status: DeliverableStatus) =>
  isDoneStatus(status) || status === "NOT_APPLICABLE";

/** "4 of 7 delivered", plus "· 1 not applicable" so N/A is never counted as delivered. */
export function progressLabel(summary: DeliverableSummary): string {
  const base = `${summary.deliveredOrCompleted} of ${summary.total} delivered`;
  return summary.notApplicable ? `${base} · ${summary.notApplicable} not applicable` : base;
}

/** A scheduled date as a calendar day (stored as midnight UTC of the picked day). */
export function formatDeliverableDate(value: string, style: "short" | "long" = "short"): string {
  return new Date(value).toLocaleDateString(undefined, {
    timeZone: "UTC",
    month: style === "long" ? "long" : "short",
    day: "numeric",
    ...(style === "long" ? { year: "numeric" } : {}),
  });
}

/** One-line status for a deliverable row: "Scheduled · Oct 21", "Delivered · 4 shared". */
export function deliverableStatusLine(item: EnrollmentDeliverable): string {
  if (item.status === "NOT_APPLICABLE") return "Not applicable this period";
  const parts = [DELIVERABLE_STATUS_LABELS[item.status]];
  if (item.scheduledFor) parts.push(formatDeliverableDate(item.scheduledFor));
  if (item.outcome) parts.push(item.outcome);
  return parts.join(" · ");
}

/**
 * The next action in one line: "LIVE Grant Giveaway · Scheduled · Nov 2",
 * "All current deliverables completed", or null when there is nothing to show.
 */
export function nextActionText(
  next: { title: string; status: DeliverableStatus; scheduledFor: string | null } | null,
  allResolved: boolean,
): string | null {
  if (next) {
    const parts = [next.title, DELIVERABLE_STATUS_LABELS[next.status]];
    if (next.scheduledFor) parts.push(formatDeliverableDate(next.scheduledFor));
    return parts.join(" · ");
  }
  return allResolved ? "All current deliverables completed" : null;
}

/** Whether every deliverable in a period with deliverables is resolved. */
export const allDeliverablesResolved = (summary: DeliverableSummary) =>
  summary.total > 0 && summary.open === 0;

/** "Oct 2026: 3 of 7 delivered; Nov 2026: 6 of 7 delivered" — the short form stored with a report. */
export function programHistorySummary(history: ProgramHistory): string {
  return history.months
    .map((month) => `${month.label}: ${progressLabel(month.summary)}`)
    .join("; ");
}
