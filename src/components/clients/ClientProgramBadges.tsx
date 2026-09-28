import { StatusBadge } from "@/components/StatusBadge";
import { displayEnrollmentStatus, uniqueEnrollments } from "@/lib/enrollment-status";
import type { ProgramEnrollment } from "@/types";

/**
 * Program membership for one client, rendered from its enrollments only (never the legacy
 * client.programId) and deduplicated by enrollment id.
 */
export function ClientProgramBadges({
  enrollments,
  programName,
}: {
  enrollments: readonly ProgramEnrollment[];
  programName: (programId: string) => string;
}) {
  const unique = uniqueEnrollments(enrollments);
  if (unique.length === 0) {
    return <span className="text-xs text-muted-foreground">No program</span>;
  }
  return (
    <div className="flex flex-wrap gap-1.5">
      {unique.map((enrollment) => (
        <span key={enrollment.id} className="inline-flex items-center gap-1">
          <span className="text-xs">{programName(enrollment.programId)}</span>
          <StatusBadge status={displayEnrollmentStatus(enrollment.status)} />
        </span>
      ))}
    </div>
  );
}
