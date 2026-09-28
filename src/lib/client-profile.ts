import { isActiveEnrollmentStatus, uniqueEnrollments } from "@/lib/enrollment-status";

/** The one canonical tab set for the client profile, in display order. */
export const CLIENT_TABS = [
  "overview",
  "program",
  "billing",
  "forms",
  "contracts",
  "documents",
  "communications",
  "monitoring",
  "final",
  "activity",
] as const;

export type ClientTab = (typeof CLIENT_TABS)[number];

export const CLIENT_TAB_LABELS: Record<ClientTab, string> = {
  overview: "Overview",
  program: "Program",
  billing: "Billing",
  forms: "Forms",
  contracts: "Contracts",
  documents: "Documents",
  communications: "Communications",
  monitoring: "Monitoring",
  final: "Final Report",
  activity: "Activity",
};

export interface ClientProfileSearch {
  /** The selected CfProgramEnrollment. Enrollment-scoped tabs all read this one value. */
  enrollmentId?: string;
  /** Legacy param from older links; resolved to an enrollment and then removed from the URL. */
  programId?: string;
  tab?: ClientTab;
}

/** Route `validateSearch`: keeps only known values so a bad URL degrades to the defaults. */
export function parseClientProfileSearch(search: Record<string, unknown>): ClientProfileSearch {
  const tab = (CLIENT_TABS as readonly string[]).includes(search.tab as string)
    ? (search.tab as ClientTab)
    : undefined;
  return {
    enrollmentId: typeof search.enrollmentId === "string" && search.enrollmentId ? search.enrollmentId : undefined,
    programId: typeof search.programId === "string" && search.programId ? search.programId : undefined,
    tab,
  };
}

interface EnrollmentLike {
  id: string;
  programId: string;
  status: string;
}

/**
 * Which enrollment the profile is "working in".
 * 1. A valid `enrollmentId` from the URL wins.
 * 2. A legacy `programId` resolves to that client's enrollment in the program.
 * 3. Otherwise a single enrollment is selected automatically; with several, the first active one
 *    (else the first), so every enrollment-scoped tab stays consistent and refresh-stable.
 * Returns undefined only when the client has no enrollments.
 */
export function resolveSelectedEnrollmentId(
  enrollments: readonly EnrollmentLike[],
  search: Pick<ClientProfileSearch, "enrollmentId" | "programId">,
): string | undefined {
  const unique = uniqueEnrollments(enrollments);
  if (unique.length === 0) return undefined;
  if (search.enrollmentId && unique.some((enrollment) => enrollment.id === search.enrollmentId)) {
    return search.enrollmentId;
  }
  if (search.programId) {
    const legacy = unique.find((enrollment) => enrollment.programId === search.programId);
    if (legacy) return legacy.id;
  }
  return (unique.find((enrollment) => isActiveEnrollmentStatus(enrollment.status)) ?? unique[0]).id;
}

/** Whether the URL needs rewriting (missing/invalid enrollmentId, or the legacy programId present). */
export function needsSearchNormalization(
  resolvedEnrollmentId: string | undefined,
  search: Pick<ClientProfileSearch, "enrollmentId" | "programId">,
): boolean {
  if (search.programId) return true;
  return resolvedEnrollmentId !== undefined && resolvedEnrollmentId !== search.enrollmentId;
}

/**
 * Records that carry an enrollmentId follow the selected enrollment; records without one
 * (client-wide) are shown for every enrollment so nothing disappears.
 */
export function inSelectedEnrollment(
  record: { enrollmentId?: string | null },
  selectedEnrollmentId: string | undefined,
): boolean {
  if (!selectedEnrollmentId) return true;
  return !record.enrollmentId || record.enrollmentId === selectedEnrollmentId;
}
