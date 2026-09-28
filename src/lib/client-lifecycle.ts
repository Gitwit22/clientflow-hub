import type { Client, ProgramEnrollment } from "@/types";
import { isActiveEnrollmentStatus, isOnboardingEnrollmentStatus } from "@/lib/enrollment-status";

export type LifecycleBucket = "onboarding" | "active" | "archived";

/**
 * Client-level bucket derived from their program enrollments, not CfClient.status (which is a
 * workflow-step field, not a lifecycle summary). A client with no active program enrollments yet
 * (including zero enrollments at all) is grouped with "onboarding" since there's no separate
 * "brand new" tab in the simplified Clients page.
 */
export function lifecycleBucket(client: Client, clientEnrollments: ProgramEnrollment[]): LifecycleBucket {
  if (client.isArchived) return "archived";
  const relevant = clientEnrollments.filter((enrollment) => !enrollment.isArchived);
  if (relevant.length === 0) return "onboarding";
  if (relevant.some((enrollment) => isOnboardingEnrollmentStatus(enrollment.status))) return "onboarding";
  if (relevant.some((enrollment) => isActiveEnrollmentStatus(enrollment.status))) return "active";
  return "archived";
}
