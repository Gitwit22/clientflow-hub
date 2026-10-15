import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { cfGetProgramHistory } from "@/lib/apiClient";
import {
  DELIVERABLE_STATUS_LABELS,
  formatDeliverableDate,
  progressLabel,
  type ProgramHistory,
} from "@/lib/program-deliverables";

/**
 * Final Report: what the client asked for and every month's program deliverables, read live from
 * the client's deliverable records (never retyped or copied), oldest month first.
 */
export function ProgramHistoryReport({
  enrollmentId,
  onLoaded,
}: {
  enrollmentId: string;
  onLoaded?: (history: ProgramHistory) => void;
}) {
  const [history, setHistory] = useState<ProgramHistory | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setHistory(null);
    setFailed(false);
    cfGetProgramHistory(enrollmentId)
      .then((result) => {
        if (cancelled) return;
        setHistory(result);
        onLoaded?.(result);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
    };
    // onLoaded is a callback from the parent; reloading only when the enrollment changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enrollmentId]);

  if (failed) {
    return <p className="text-sm text-muted-foreground">Program history couldn't be loaded.</p>;
  }
  if (!history) return <p className="text-sm text-muted-foreground">Loading program history…</p>;

  const request = history.originalRequest;
  return (
    <div className="space-y-4" aria-label="Program performance">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Original assistance requested
        </p>
        <p className="mt-0.5 whitespace-pre-wrap text-sm">
          {request.assistanceRequested ?? "Not provided on the intake"}
        </p>
        {request.budgetNeed && (
          <p className="mt-0.5 text-xs text-muted-foreground">
            Stated funding need: {request.budgetNeed}
          </p>
        )}
      </div>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Program performance
        </p>
        {history.months.length === 0 ? (
          <p className="mt-0.5 text-sm text-muted-foreground">No program deliverables recorded.</p>
        ) : (
          <ol className="mt-2 space-y-3">
            {history.months.map((month) => (
              <li key={month.cycleId} aria-label={month.label}>
                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                  {month.label} — {progressLabel(month.summary)}
                  {month.status === "OPEN" && (
                    <Badge variant="outline" className="font-normal">
                      In progress
                    </Badge>
                  )}
                </p>
                <ul className="mt-1 space-y-0.5 text-sm">
                  {month.items.map((item) => (
                    <li key={item.id} className="text-muted-foreground">
                      <span className="text-foreground">{item.title}</span> —{" "}
                      {DELIVERABLE_STATUS_LABELS[item.status]}
                      {item.scheduledFor ? ` · ${formatDeliverableDate(item.scheduledFor)}` : ""}
                      {item.outcome ? ` · ${item.outcome}` : ""}
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
