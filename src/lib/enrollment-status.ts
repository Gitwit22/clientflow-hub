/** Simplified staff-facing labels for the raw CfProgramEnrollment.status values — display only, backend enum is unchanged. */
export const ENROLLMENT_STATUS_LABELS: Record<string, string> = {
  interested: "New",
  pending_review: "Onboarding",
  approved: "Onboarding",
  onboarding: "Onboarding",
  active: "Active",
  on_hold: "On Hold",
  completed: "Completed",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

export function displayEnrollmentStatus(status: string): string {
  return ENROLLMENT_STATUS_LABELS[status] ?? status;
}

/**
 * Dedupe by enrollment id. Enrollment identity is authoritative: it removes repeated copies of the
 * same row without collapsing distinct records if the model ever allows re-enrollment.
 */
export function uniqueEnrollments<T extends { id: string }>(enrollments: readonly T[]): T[] {
  return Array.from(new Map(enrollments.map((enrollment) => [enrollment.id, enrollment])).values());
}

export function isTerminalEnrollmentStatus(status: string): boolean {
  return status === "completed" || status === "declined" || status === "withdrawn";
}

export function isOnboardingEnrollmentStatus(status: string): boolean {
  return (
    status === "interested" ||
    status === "pending_review" ||
    status === "approved" ||
    status === "onboarding"
  );
}

export function isActiveEnrollmentStatus(status: string): boolean {
  return status === "active" || status === "on_hold";
}

/**
 * The programs a client is in, named from their enrollments (never the legacy client.programId).
 * Open enrollments come first; closed ones are listed only when `includeClosed` is set (the archive,
 * where every enrollment is closed or archived) or when there are no open ones.
 */
export function clientProgramNames(
  clientId: string,
  enrollments: readonly {
    id: string;
    clientId: string;
    programId: string;
    status: string;
    isArchived?: boolean;
  }[],
  programs: readonly { id: string; name: string }[],
  options: { includeClosed?: boolean } = {},
): string[] {
  const mine = uniqueEnrollments(
    enrollments.filter((enrollment) => enrollment.clientId === clientId),
  );
  const open = mine.filter(
    (enrollment) => !enrollment.isArchived && !isTerminalEnrollmentStatus(enrollment.status),
  );
  const chosen = options.includeClosed || open.length === 0 ? mine : open;
  const names = chosen
    .map((enrollment) => programs.find((program) => program.id === enrollment.programId)?.name)
    .filter((name): name is string => Boolean(name));
  return Array.from(new Set(names));
}

/** True when the client has at least one enrollment that is still open. */
export function hasOpenEnrollment(
  clientId: string,
  enrollments: readonly { clientId: string; status: string; isArchived?: boolean }[],
): boolean {
  return enrollments.some(
    (enrollment) =>
      enrollment.clientId === clientId &&
      !enrollment.isArchived &&
      !isTerminalEnrollmentStatus(enrollment.status),
  );
}
