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
