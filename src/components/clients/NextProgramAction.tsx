import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cfGetCurrentDeliverables } from "@/lib/apiClient";
import {
  formatDeliverableDate,
  progressLabel,
  type DeliverableCycleView,
} from "@/lib/program-deliverables";

/**
 * Overview: the one deliverable picked as the enrollment's next program action (staff's explicit
 * choice, else the nearest scheduled unfinished item) and this month's progress.
 */
export function NextProgramAction({
  enrollmentId,
  onViewDeliverables,
}: {
  enrollmentId: string;
  onViewDeliverables: () => void;
}) {
  const [view, setView] = useState<DeliverableCycleView | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setView(null);
    setFailed(false);
    cfGetCurrentDeliverables(enrollmentId)
      .then((result) => !cancelled && setView(result))
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
  }, [enrollmentId]);

  // No configured deliverables (or not loaded): nothing extra on the Overview.
  if (failed || !view?.cycle) return null;
  const next = view.nextAction;

  return (
    <div className="border-b border-border py-2 last:border-0" aria-label="Next program action">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Next program action
      </p>
      {next ? (
        <p className="mt-0.5 text-sm">
          <span className="font-medium">{next.titleSnapshot}</span>
          {next.scheduledFor && (
            <span className="text-muted-foreground">
              {" "}
              · {formatDeliverableDate(next.scheduledFor, "long")}
            </span>
          )}
        </p>
      ) : (
        <p className="mt-0.5 text-sm text-muted-foreground">No next program action selected</p>
      )}
      <p className="mt-1 text-xs text-muted-foreground">
        {view.cycle.label} deliverables: {progressLabel(view.summary)}
      </p>
      <Button
        type="button"
        variant="link"
        size="sm"
        className="h-auto px-0"
        onClick={onViewDeliverables}
      >
        View program deliverables
      </Button>
    </div>
  );
}
