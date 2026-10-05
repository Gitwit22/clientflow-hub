import type { ProgramEnrollment } from "@/types";
import { isTerminalEnrollmentStatus } from "@/lib/enrollment-status";

type DatedEnrollment = Pick<
  ProgramEnrollment,
  "status" | "startDate" | "completedAt" | "withdrawnAt" | "createdAt"
>;

function formatDate(value: string) {
  return new Date(value).toLocaleDateString();
}

/** When the enrollment ended (completed or withdrawn), or null while it is current. */
export function enrollmentEndedAt(enrollment: DatedEnrollment): string | null {
  return enrollment.completedAt ?? enrollment.withdrawnAt ?? null;
}

/**
 * "Joined …" for an enrollment. Joined is the day the client signed the program's contract (set
 * automatically on signing, editable by staff for clients who joined before ClientFlow).
 */
export function joinedLabel(enrollment: DatedEnrollment): string {
  if (enrollment.startDate) return `Joined ${formatDate(enrollment.startDate)}`;
  return isTerminalEnrollmentStatus(enrollment.status)
    ? "Joined: not recorded"
    : "Joined: when the contract is signed";
}

/** "Joined … · Ended …" for the client's program history. */
export function enrollmentDatesLabel(enrollment: DatedEnrollment): string {
  const ended = enrollmentEndedAt(enrollment);
  return ended
    ? `${joinedLabel(enrollment)} · Ended ${formatDate(ended)}`
    : joinedLabel(enrollment);
}

/** Current programs first (newest joined first), then past ones by most recently ended. */
export function sortByProgramHistory<T extends DatedEnrollment>(enrollments: readonly T[]): T[] {
  const time = (value?: string | null) => (value ? Date.parse(value) : 0);
  const current = (enrollment: T) => !isTerminalEnrollmentStatus(enrollment.status);
  return [...enrollments].sort((a, b) => {
    if (current(a) !== current(b)) return current(a) ? -1 : 1;
    if (current(a)) return time(b.startDate ?? b.createdAt) - time(a.startDate ?? a.createdAt);
    return time(enrollmentEndedAt(b) ?? b.createdAt) - time(enrollmentEndedAt(a) ?? a.createdAt);
  });
}

/** The value a date input shows for a stored date. */
export function dateInputValue(value?: string | null): string {
  if (!value) return "";
  const date = new Date(value);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A picked calendar day as a timestamp at local noon, so it shows as the same day in any
 * timezone staff are likely to be in. Empty clears the date.
 */
export function joinedDateFromInput(value: string): string | null {
  return value ? new Date(`${value}T12:00:00`).toISOString() : null;
}
