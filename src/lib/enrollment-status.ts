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

export function isTerminalEnrollmentStatus(status: string): boolean {
  return status === "completed" || status === "declined" || status === "withdrawn";
}

export function isOnboardingEnrollmentStatus(status: string): boolean {
  return (
    status === "interested"
    || status === "pending_review"
    || status === "approved"
    || status === "onboarding"
  );
}

export function isActiveEnrollmentStatus(status: string): boolean {
  return status === "active" || status === "on_hold";
}
