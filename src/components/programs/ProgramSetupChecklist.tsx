import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";
import { CollapsibleSection } from "@/components/CollapsibleSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { updateProgram } from "@/lib/api";
import { cfGetProgramSetup } from "@/lib/apiClient";
import type { ProgramSetup, ProgramSetupItem } from "@/types";

/** Where each checklist item is set up, as shown on its "Go to" link. */
const GO_TO_LABEL: Record<ProgramSetupItem["key"], string> = {
  intake_form: "Go to Program questions",
  enrollment_agreement: "Go to Agreements",
  welcome_email: "Go to Welcome email",
  deliverables: "Go to Deliverables",
  billing: "Go to Billing",
  award_agreement: "Go to Agreements",
};

/** One line for the closed checklist: progress, and what still needs attention. */
function setupSummary(setup: ProgramSetup): string {
  const required = setup.items.filter((item) => item.required);
  const done = required.filter((item) => item.done).length;
  const progress = `${done} of ${required.length} required step${required.length === 1 ? "" : "s"} done`;
  if (!setup.ready) {
    return `${progress}. Needs attention: ${setup.missingRequired.map((item) => item.label).join(", ")}.`;
  }
  return `${progress}. ${setup.isActive ? "Ready and active." : "Ready to activate."}`;
}

/**
 * What the program needs before it can take clients. Only what this program's workflow uses is
 * required (an agreement only when its journey has a Contract stage, and so on). The server checks
 * the same list when the program is activated.
 */
export function ProgramSetupChecklist({
  programId,
  refreshKey,
  onActivated,
  open,
  onOpenChange,
  onGoTo,
}: {
  programId: string;
  /** Changes whenever the program page reloads, so the checklist follows edits made elsewhere. */
  refreshKey: number;
  onActivated: () => void;
  /** Controlled from the page; when omitted the checklist keeps its own open state. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Opens the place where an item is set up; items get a "Go to" link when given. */
  onGoTo?: (key: ProgramSetupItem["key"]) => void;
}) {
  const [setup, setSetup] = useState<ProgramSetup | null>(null);
  const [activating, setActivating] = useState(false);
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  // Opens once, when the program is first loaded, if something still needs doing.
  const openedFor = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    cfGetProgramSetup(programId)
      .then((result) => {
        if (cancelled) return;
        setSetup(result);
        if (openedFor.current !== programId) {
          openedFor.current = programId;
          if (!result.ready || !result.isActive) {
            if (open === undefined) setOwnOpen(true);
            onOpenChange?.(true);
          }
        }
      })
      .catch(() => !cancelled && setSetup(null));
    return () => {
      cancelled = true;
    };
    // Only reload when the program or the page's data changes; open state is handled above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [programId, refreshKey]);

  if (!setup) return null;

  async function activate() {
    setActivating(true);
    try {
      await updateProgram(programId, { isActive: true });
      toast.success("Program activated. It can now take clients.");
      onActivated();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to activate the program.");
    } finally {
      setActivating(false);
    }
  }

  return (
    <div aria-label="Setup checklist" className="lg:col-span-2">
      <CollapsibleSection
        id="setup-checklist"
        title="Setup checklist"
        summary={setupSummary(setup)}
        open={isOpen}
        onOpenChange={setOpen}
      >
        <div className="space-y-3 text-sm">
          {setup.ready ? (
            <Badge>{setup.isActive ? "Ready and active" : "Ready to activate"}</Badge>
          ) : (
            <Badge variant="outline">
              {setup.missingRequired.length} required item
              {setup.missingRequired.length === 1 ? "" : "s"} left
            </Badge>
          )}
          {setup.isActive && !setup.ready && (
            <p role="alert" className="text-destructive">
              This program is active but is missing required setup. Clients can still enroll; finish
              the items below so every step works.
            </p>
          )}
          <ul className="space-y-2">
            {setup.items.map((item) => (
              <li key={item.key} className="flex items-start gap-2">
                {item.done ? (
                  <CheckCircle2
                    className="mt-0.5 h-4 w-4 shrink-0 text-primary"
                    aria-label="Done"
                  />
                ) : (
                  <Circle
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                    aria-label="Not done"
                  />
                )}
                <div className="min-w-0">
                  <p className="font-medium">
                    {item.label}{" "}
                    <span className="text-xs font-normal text-muted-foreground">
                      {item.required ? "Required" : "Optional"}
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">{item.detail}</p>
                  {!item.done && onGoTo && (
                    <Button
                      variant="link"
                      size="sm"
                      className="h-auto p-0 text-xs"
                      onClick={() => onGoTo(item.key)}
                    >
                      {GO_TO_LABEL[item.key]}
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
          {!setup.isActive && (
            <Button disabled={!setup.ready || activating} onClick={() => void activate()}>
              {activating ? "Activating…" : "Activate program"}
            </Button>
          )}
        </div>
      </CollapsibleSection>
    </div>
  );
}
