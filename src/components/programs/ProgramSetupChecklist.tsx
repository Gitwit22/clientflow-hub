import { useEffect, useState } from "react";
import { CheckCircle2, Circle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateProgram } from "@/lib/api";
import { cfGetProgramSetup } from "@/lib/apiClient";
import type { ProgramSetup } from "@/types";

/**
 * What the program needs before it can take clients. Only what this program's workflow uses is
 * required (an agreement only when its journey has a Contract stage, and so on). The server checks
 * the same list when the program is activated.
 */
export function ProgramSetupChecklist({
  programId,
  refreshKey,
  onActivated,
}: {
  programId: string;
  /** Changes whenever the program page reloads, so the checklist follows edits made elsewhere. */
  refreshKey: number;
  onActivated: () => void;
}) {
  const [setup, setSetup] = useState<ProgramSetup | null>(null);
  const [activating, setActivating] = useState(false);

  useEffect(() => {
    let cancelled = false;
    cfGetProgramSetup(programId)
      .then((result) => !cancelled && setSetup(result))
      .catch(() => !cancelled && setSetup(null));
    return () => {
      cancelled = true;
    };
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
    <Card className="shadow-card lg:col-span-2" aria-label="Setup checklist">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="font-display text-base">Setup checklist</CardTitle>
        {setup.ready ? (
          <Badge>{setup.isActive ? "Ready and active" : "Ready to activate"}</Badge>
        ) : (
          <Badge variant="outline">
            {setup.missingRequired.length} required item
            {setup.missingRequired.length === 1 ? "" : "s"} left
          </Badge>
        )}
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
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
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-label="Done" />
              ) : (
                <Circle
                  className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground"
                  aria-label="Not done"
                />
              )}
              <div>
                <p className="font-medium">
                  {item.label}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    {item.required ? "Required" : "Optional"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">{item.detail}</p>
              </div>
            </li>
          ))}
        </ul>
        {!setup.isActive && (
          <Button disabled={!setup.ready || activating} onClick={() => void activate()}>
            {activating ? "Activating…" : "Activate program"}
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
