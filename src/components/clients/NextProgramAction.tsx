import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { cfGetCurrentDeliverables } from "@/lib/apiClient";
import {
  DELIVERABLE_STATUS_LABELS,
  allDeliverablesResolved,
  formatDeliverableDate,
  progressLabel,
  type DeliverableCycleView,
} from "@/lib/program-deliverables";

/**
 * Overview: the enrollment's next action, worked out from this month's program deliverables
 * (staff's marked item, else the nearest dated one, else one in progress, else the next open one),
 * with the month's progress. Staff never maintain it by hand.
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

  if (failed || !view) return null;
  const next = view.nextAction;

  return (
    <div className="border-b border-border py-2 last:border-0" aria-label="Next action">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        Next action
      </p>
      {!view.cycle ? (
        <p className="mt-0.5 text-sm text-muted-foreground">
          {view.reason === "no_deliverables_configured"
            ? "No program deliverables set up"
            : "Starts once the enrollment is active"}
        </p>
      ) : (
        <>
          {next ? (
            <p className="mt-0.5 text-sm">
              <span className="font-medium">{next.titleSnapshot}</span>
              <span className="text-muted-foreground">
                {" "}
                · {DELIVERABLE_STATUS_LABELS[next.status]}
                {next.scheduledFor ? ` · ${formatDeliverableDate(next.scheduledFor, "long")}` : ""}
              </span>
            </p>
          ) : (
            <p className="mt-0.5 text-sm">
              {allDeliverablesResolved(view.summary)
                ? "All current deliverables completed"
                : "Nothing open this month"}
            </p>
          )}
          <p className="mt-1 text-xs text-muted-foreground">
            {view.cycle.label} · {progressLabel(view.summary)}
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
        </>
      )}
    </div>
  );
}
