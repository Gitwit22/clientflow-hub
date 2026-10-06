import { useCallback, useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DeliverableCycleReport } from "@/components/clients/DeliverableCycleReport";
import { DeliverableEditDialog } from "@/components/clients/DeliverableEditDialog";
import {
  cfFinalizeDeliverableCycle,
  cfGetCurrentDeliverables,
  cfGetDeliverableCycle,
  cfListDeliverableHistory,
} from "@/lib/apiClient";
import {
  deliverableStatusLine,
  isDoneStatus,
  progressLabel,
  type DeliverableCycleHistoryEntry,
  type DeliverableCycleView,
  type EnrollmentDeliverable,
} from "@/lib/program-deliverables";

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/**
 * The client's Program Deliverables for one enrollment: this month's checklist (created on first
 * load), past months, a report per month, and finalizing a month.
 */
export function ProgramDeliverablesCard({
  enrollmentId,
  clientName,
  programName,
}: {
  enrollmentId: string;
  clientName: string;
  programName: string;
}) {
  const [view, setView] = useState<"current" | "history">("current");
  const [current, setCurrent] = useState<DeliverableCycleView | null>(null);
  const [history, setHistory] = useState<DeliverableCycleHistoryEntry[] | null>(null);
  const [opened, setOpened] = useState<DeliverableCycleView | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCurrent = useCallback(() => {
    setError(null);
    return cfGetCurrentDeliverables(enrollmentId)
      .then(setCurrent)
      .catch((reason: unknown) => setError(errorMessage(reason, "Unable to load deliverables.")));
  }, [enrollmentId]);

  useEffect(() => {
    setCurrent(null);
    setHistory(null);
    setOpened(null);
    setView("current");
    void loadCurrent();
  }, [loadCurrent]);

  useEffect(() => {
    if (view !== "history") return;
    cfListDeliverableHistory(enrollmentId)
      .then(setHistory)
      .catch((reason: unknown) => setError(errorMessage(reason, "Unable to load past months.")));
  }, [view, enrollmentId]);

  async function openCycle(cycleId: string) {
    try {
      setOpened(await cfGetDeliverableCycle(enrollmentId, cycleId));
    } catch (reason) {
      toast.error(errorMessage(reason, "Unable to open that month."));
    }
  }

  async function refreshShown() {
    if (opened?.cycle) {
      setOpened(await cfGetDeliverableCycle(enrollmentId, opened.cycle.id));
      setHistory(null);
      if (view === "history") setHistory(await cfListDeliverableHistory(enrollmentId));
    }
    await loadCurrent();
  }

  const shown = view === "current" ? current : opened;

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <CardTitle className="font-display text-base">Program Deliverables</CardTitle>
        <div className="flex gap-1" aria-label="Deliverables period">
          <Button
            size="sm"
            aria-pressed={view === "current"}
            variant={view === "current" ? "default" : "ghost"}
            onClick={() => {
              setView("current");
              setOpened(null);
            }}
          >
            Current month
          </Button>
          <Button
            size="sm"
            aria-pressed={view === "history"}
            variant={view === "history" ? "default" : "ghost"}
            onClick={() => setView("history")}
          >
            History
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <p className="text-sm text-destructive">{error}</p>
        ) : view === "history" && !opened ? (
          <HistoryList history={history} onOpen={(id) => void openCycle(id)} />
        ) : !shown ? (
          <p className="text-sm text-muted-foreground">Loading deliverables…</p>
        ) : !shown.cycle ? (
          <p className="text-sm text-muted-foreground">
            {shown.reason === "enrollment_not_active"
              ? "Deliverables are tracked once the enrollment is active."
              : "No program deliverables configured."}
          </p>
        ) : (
          <>
            {view === "history" && (
              <Button
                size="sm"
                variant="ghost"
                className="mb-2 -ml-2"
                onClick={() => setOpened(null)}
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                All months
              </Button>
            )}
            <CycleChecklist
              enrollmentId={enrollmentId}
              view={shown}
              clientName={clientName}
              programName={programName}
              onChanged={() => void refreshShown()}
            />
          </>
        )}
      </CardContent>
    </Card>
  );
}

function HistoryList({
  history,
  onOpen,
}: {
  history: DeliverableCycleHistoryEntry[] | null;
  onOpen: (cycleId: string) => void;
}) {
  if (!history) return <p className="text-sm text-muted-foreground">Loading past months…</p>;
  if (history.length === 0) {
    return <p className="text-sm text-muted-foreground">No months tracked yet.</p>;
  }
  return (
    <ul className="divide-y divide-border">
      {history.map((cycle) => (
        <li key={cycle.id}>
          <button
            type="button"
            className="flex w-full items-center justify-between gap-2 py-2.5 text-left hover:bg-muted/40"
            onClick={() => onOpen(cycle.id)}
          >
            <span className="font-medium">{cycle.label}</span>
            <span className="text-xs text-muted-foreground">
              {progressLabel(cycle.summary)}
              {cycle.status === "FINALIZED" ? " · Finalized" : ""}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CycleChecklist({
  enrollmentId,
  view,
  clientName,
  programName,
  onChanged,
}: {
  enrollmentId: string;
  view: DeliverableCycleView;
  clientName: string;
  programName: string;
  onChanged: () => void;
}) {
  const cycle = view.cycle!;
  const finalized = cycle.status === "FINALIZED";
  const [editing, setEditing] = useState<EnrollmentDeliverable | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [confirmFinalize, setConfirmFinalize] = useState(false);
  const [finalizing, setFinalizing] = useState(false);

  async function finalize() {
    setFinalizing(true);
    try {
      await cfFinalizeDeliverableCycle(enrollmentId, cycle.id);
      toast.success(`${cycle.label} finalized.`);
      setConfirmFinalize(false);
      onChanged();
    } catch (error) {
      toast.error(errorMessage(error, "Unable to finalize the month."));
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <p className="font-medium">{cycle.label}</p>
          <p className="text-xs text-muted-foreground">
            {progressLabel(view.summary)}
            {finalized && cycle.finalizedAt
              ? ` · Finalized ${new Date(cycle.finalizedAt).toLocaleDateString()}`
              : ""}
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => setReportOpen(true)}>
            View report
          </Button>
          {!finalized &&
            (confirmFinalize ? (
              <>
                <Button size="sm" onClick={() => void finalize()} disabled={finalizing}>
                  {finalizing ? "Finalizing…" : `Finalize ${cycle.label}`}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmFinalize(false)}>
                  Cancel
                </Button>
              </>
            ) : (
              <Button size="sm" variant="outline" onClick={() => setConfirmFinalize(true)}>
                Finalize month
              </Button>
            ))}
        </div>
      </div>
      {confirmFinalize && (
        <p className="text-xs text-muted-foreground">
          Finalizing locks {cycle.label}: it can no longer be edited.
        </p>
      )}
      <ul className="divide-y divide-border">
        {view.items.map((item) => (
          <li key={item.id} className="flex items-start justify-between gap-3 py-2.5">
            <div className="min-w-0">
              <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                {item.titleSnapshot}
                {item.isNextAction && !isDoneStatus(item.status) && (
                  <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">
                    Next action
                  </span>
                )}
              </p>
              <p className="text-xs text-muted-foreground">{deliverableStatusLine(item)}</p>
              {item.notes && <p className="text-xs text-muted-foreground">{item.notes}</p>}
            </div>
            {!finalized && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 px-2 text-xs"
                aria-label={`Update ${item.titleSnapshot}`}
                onClick={() => setEditing(item)}
              >
                Update
              </Button>
            )}
          </li>
        ))}
      </ul>
      <DeliverableEditDialog
        enrollmentId={enrollmentId}
        deliverable={editing}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={onChanged}
      />
      <Dialog open={reportOpen} onOpenChange={setReportOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="sr-only">{cycle.label} report</DialogTitle>
          </DialogHeader>
          <DeliverableCycleReport
            cycle={cycle}
            items={view.items}
            summary={view.summary}
            clientName={clientName}
            programName={programName}
          />
        </DialogContent>
      </Dialog>
    </div>
  );
}
