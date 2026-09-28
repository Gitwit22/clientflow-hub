import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { displayEnrollmentStatus } from "@/lib/enrollment-status";
import type { Program, ProgramEnrollment } from "@/types";

/**
 * The single place the client profile shows program context. Membership comes only from the
 * client's enrollments: zero → enroll UI, one → static summary, several → a selector that drives
 * every enrollment-scoped tab through the URL.
 */
export function EnrollmentContextBar({
  enrollments,
  programs,
  selectedEnrollmentId,
  canEnroll,
  onSelect,
  onEnroll,
}: {
  enrollments: readonly ProgramEnrollment[];
  programs: readonly Program[];
  selectedEnrollmentId: string | undefined;
  canEnroll: boolean;
  onSelect: (enrollmentId: string) => void;
  onEnroll: (programId: string) => Promise<void>;
}) {
  const [programToEnroll, setProgramToEnroll] = useState("");
  const [enrolling, setEnrolling] = useState(false);
  const programName = (programId: string) =>
    programs.find((program) => program.id === programId)?.name ?? "Unknown program";

  if (enrollments.length === 0) {
    if (!canEnroll) return null;
    return (
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border p-3">
        <span className="text-sm text-muted-foreground">No program enrollment</span>
        <Select value={programToEnroll} onValueChange={setProgramToEnroll}>
          <SelectTrigger className="h-8 w-56" aria-label="Program to enroll in">
            <SelectValue placeholder="Select a program…" />
          </SelectTrigger>
          <SelectContent>
            {programs.map((program) => (
              <SelectItem key={program.id} value={program.id}>
                {program.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          type="button"
          size="sm"
          disabled={!programToEnroll || enrolling}
          onClick={async () => {
            setEnrolling(true);
            try {
              await onEnroll(programToEnroll);
              setProgramToEnroll("");
            } finally {
              setEnrolling(false);
            }
          }}
        >
          {enrolling ? "Enrolling…" : "Enroll client"}
        </Button>
      </div>
    );
  }

  const selected = enrollments.find((enrollment) => enrollment.id === selectedEnrollmentId);
  const others = enrollments.length - 1;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
      {enrollments.length === 1 && selected ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Program</span>
          <span className="font-medium">{programName(selected.programId)}</span>
          <StatusBadge status={displayEnrollmentStatus(selected.status)} />
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Working in:</span>
          <Select value={selectedEnrollmentId ?? ""} onValueChange={onSelect}>
            <SelectTrigger className="h-8 w-72" aria-label="Working in program">
              <SelectValue placeholder="Select a program…" />
            </SelectTrigger>
            <SelectContent>
              {enrollments.map((enrollment) => (
                <SelectItem key={enrollment.id} value={enrollment.id}>
                  {programName(enrollment.programId)} · {displayEnrollmentStatus(enrollment.status)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {others > 0 && (
            <span className="text-xs text-muted-foreground">
              {others} other enrollment{others === 1 ? "" : "s"}
            </span>
          )}
        </div>
      )}
      {selected && (
        <Button type="button" variant="ghost" size="sm" asChild>
          <Link to="/programs/$programId" params={{ programId: selected.programId }}>
            Back to program
          </Link>
        </Button>
      )}
    </div>
  );
}
