import { Link } from "@tanstack/react-router";
import { CheckCircle2, ChevronDown, UserMinus } from "lucide-react";
import { ParticipantProgressPanel } from "./ParticipantProgressPanel";
import { ParticipantRepliesPanel } from "./ParticipantRepliesPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { displayEnrollmentStatus } from "@/lib/enrollment-status";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ProgramParticipantDetail } from "@/types";

export function ProgramParticipantRow({
  participant,
  assignedStaffName,
  lastModifiedByName,
  open,
  onOpenChange,
  canWithdraw,
  onWithdraw,
  canComplete,
  onComplete,
}: {
  participant: ProgramParticipantDetail;
  assignedStaffName: string;
  lastModifiedByName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWithdraw: boolean;
  onWithdraw: () => void;
  canComplete: boolean;
  onComplete: () => void;
}) {
  const { client, enrollment } = participant;

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="border-b border-border last:border-0">
      <div className="grid gap-4 py-4 md:grid-cols-[minmax(0,1fr)_auto_auto] md:items-center">
        <div className="min-w-0">
          <Link
            to="/clients/$clientId"
            params={{ clientId: client.id }}
            search={{ programId: enrollment.programId, tab: "program" }}
            className="font-medium hover:text-primary"
          >
            {client.businessName}
          </Link>
          <p className="mt-1 text-xs text-muted-foreground">
            {client.primaryContactName} · {client.email} · Assigned to {assignedStaffName}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Last changed by {lastModifiedByName} · {new Date(enrollment.updatedAt).toLocaleDateString()}
          </p>
          {enrollment.nextAction && (
            <p className="mt-1 text-xs text-muted-foreground">
              Next: {enrollment.nextAction}{enrollment.nextActionDate ? ` · ${new Date(enrollment.nextActionDate).toLocaleDateString()}` : ""}
            </p>
          )}
        </div>
        <StatusBadge status={displayEnrollmentStatus(enrollment.status)} />
        <div className="flex items-center justify-end gap-1">
          {canComplete && (
            <Button variant="ghost" size="icon" aria-label={`Mark ${client.businessName} as completed`} onClick={onComplete}>
              <CheckCircle2 className="h-4 w-4" />
            </Button>
          )}
          {canWithdraw && (
            <Button variant="ghost" size="icon" aria-label={`Withdraw ${client.businessName} from program`} onClick={onWithdraw}>
              <UserMinus className="h-4 w-4" />
            </Button>
          )}
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="icon" aria-label={`${open ? "Collapse" : "Expand"} ${client.businessName} details`}>
              <ChevronDown className={`h-4 w-4 transition-transform ${open ? "rotate-180" : ""}`} />
            </Button>
          </CollapsibleTrigger>
        </div>
      </div>
      <CollapsibleContent className="pb-6">
        <div className="space-y-6 bg-muted/35 px-4 py-5 sm:px-6">
          <ParticipantRepliesPanel coreIntake={participant.coreIntake} programIntake={participant.programIntake} forms={participant.forms} />
          <ParticipantProgressPanel
            enrollment={enrollment}
            assignedStaffName={assignedStaffName}
            lastModifiedByName={lastModifiedByName}
            terms={participant.terms}
            contracts={participant.contracts}
            monitoring={participant.monitoring}
            statusHistory={participant.statusHistory}
          />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}