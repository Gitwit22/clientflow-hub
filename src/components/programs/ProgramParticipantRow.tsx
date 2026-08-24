import { Link } from "@tanstack/react-router";
import { ChevronDown, UserMinus } from "lucide-react";
import { ParticipantProgressPanel } from "./ParticipantProgressPanel";
import { ParticipantRepliesPanel } from "./ParticipantRepliesPanel";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { ProgramParticipantDetail } from "@/types";

export function ProgramParticipantRow({
  participant,
  open,
  onOpenChange,
  canWithdraw,
  onWithdraw,
}: {
  participant: ProgramParticipantDetail;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  canWithdraw: boolean;
  onWithdraw: () => void;
}) {
  const { client, enrollment } = participant;
  const progress = Math.min(100, Math.max(0, enrollment.progressPercentage));

  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="border-b border-border last:border-0">
      <div className="grid gap-4 py-4 md:grid-cols-[minmax(0,1fr)_auto_10rem_auto] md:items-center">
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
            {client.primaryContactName} · {client.email} · Assigned to {enrollment.assignedStaff || "Unassigned"}
          </p>
          {enrollment.nextAction && (
            <p className="mt-1 text-xs text-muted-foreground">
              Next: {enrollment.nextAction}{enrollment.nextActionDate ? ` · ${new Date(enrollment.nextActionDate).toLocaleDateString()}` : ""}
            </p>
          )}
        </div>
        <StatusBadge status={enrollment.status} />
        <div>
          <div className="flex justify-between font-mono text-[10px] uppercase text-muted-foreground">
            <span>Progress</span><span>{progress}%</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: `${progress}%` }} />
          </div>
        </div>
        <div className="flex items-center justify-end gap-1">
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
          <ParticipantProgressPanel enrollment={enrollment} terms={participant.terms} contracts={participant.contracts} monitoring={participant.monitoring} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}