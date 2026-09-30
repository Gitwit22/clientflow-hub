import { useEffect, useState } from "react";
import { toast } from "sonner";
import { localToday } from "@/lib/dates";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cfConfirmBackfill, cfListOpenBillingPeriods, cfPreviewBackfill } from "@/lib/apiClient";
import type { BackfillPreview, OpenBillingPeriod } from "@/types";
import { formatMoney } from "@/lib/money";

export function BringAccountCurrentDialog({
  open,
  onOpenChange,
  clientId,
  enrollmentId,
  mode,
  onDone,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  enrollmentId: string;
  mode: "current" | "partial_unknown";
  onDone: () => void;
}) {
  const [paidThroughDate, setPaidThroughDate] = useState(localToday());
  const [allPeriods, setAllPeriods] = useState<OpenBillingPeriod[]>([]);
  const [checkedKeys, setCheckedKeys] = useState<Set<string>>(new Set());
  const [preview, setPreview] = useState<BackfillPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPreview(null);
    if (mode === "partial_unknown") {
      setLoading(true);
      // Pin to "now" explicitly — the shared /periods endpoint otherwise extends one period into
      // the future for prepayment support, which doesn't make sense for legacy history review.
      void cfListOpenBillingPeriods(clientId, enrollmentId, new Date().toISOString())
        .then((periods) => {
          const unpaid = periods.filter((p) => p.status !== "paid");
          setAllPeriods(unpaid);
          setCheckedKeys(new Set());
        })
        .catch((error: unknown) => {
          toast.error(error instanceof Error ? error.message : "Unable to load billing history.");
        })
        .finally(() => setLoading(false));
    }
  }, [open, mode, clientId, enrollmentId]);

  function periodKey(period: { billingPeriodStart: string; billingPeriodEnd: string }) {
    return `${period.billingPeriodStart}|${period.billingPeriodEnd}`;
  }

  async function runPreview() {
    setLoading(true);
    try {
      const selection =
        mode === "current"
          ? { paidThroughDate }
          : {
              periods: [...checkedKeys].map((key) => {
                const [start, end] = key.split("|");
                return { start, end };
              }),
            };
      const result = await cfPreviewBackfill(clientId, enrollmentId, selection);
      setPreview(result);
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to preview historical payments.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleConfirm() {
    if (!preview || preview.count === 0) return;
    setConfirming(true);
    try {
      const selection =
        mode === "current"
          ? { paidThroughDate }
          : {
              periods: [...checkedKeys].map((key) => {
                const [start, end] = key.split("|");
                return { start, end };
              }),
            };
      const result = await cfConfirmBackfill(clientId, enrollmentId, selection);
      toast.success(
        `Confirmed ${result.created} historical payment${result.created === 1 ? "" : "s"}.`,
      );
      onOpenChange(false);
      onDone();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Unable to confirm historical payments.",
      );
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Bring account current</DialogTitle>
          <DialogDescription>
            {mode === "current"
              ? "Confirm every period through a known paid-through date as an existing payment record."
              : "Pick exactly which historical periods were actually paid — nothing is assumed."}
          </DialogDescription>
        </DialogHeader>

        {mode === "current" ? (
          <div className="space-y-1.5">
            <Label>Paid through</Label>
            <Input
              type="date"
              value={paidThroughDate}
              onChange={(e) => setPaidThroughDate(e.target.value)}
            />
          </div>
        ) : (
          <div className="max-h-64 space-y-1 overflow-y-auto rounded-lg border border-border p-2">
            {allPeriods.length === 0 && !loading && (
              <p className="py-4 text-center text-sm text-muted-foreground">
                No historical periods to review.
              </p>
            )}
            {allPeriods.map((period) => {
              const key = periodKey(period);
              return (
                <label
                  key={key}
                  className="flex items-center justify-between gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted/50"
                >
                  <span className="flex items-center gap-2">
                    <Checkbox
                      checked={checkedKeys.has(key)}
                      onCheckedChange={(checked) => {
                        setCheckedKeys((prev) => {
                          const next = new Set(prev);
                          if (checked) next.add(key);
                          else next.delete(key);
                          return next;
                        });
                      }}
                    />
                    {new Date(period.dueDate).toLocaleDateString(undefined, {
                      month: "short",
                      year: "numeric",
                    })}
                  </span>
                  <span className="font-mono text-xs">{formatMoney(period.amount)}</span>
                </label>
              );
            })}
          </div>
        )}

        <Button
          variant="outline"
          onClick={() => void runPreview()}
          disabled={loading || (mode === "partial_unknown" && checkedKeys.size === 0)}
        >
          {loading ? "Loading..." : "Preview"}
        </Button>

        {preview && (
          <div className="rounded-lg border border-border p-3 text-sm">
            {preview.count === 0 ? (
              <p>Nothing new to confirm — every selected period is already recorded.</p>
            ) : (
              <p>
                This will create {preview.count} historical payment confirmation
                {preview.count === 1 ? "" : "s"} totaling {formatMoney(preview.totalAmount)}.
                Confirm?
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => void handleConfirm()}
            disabled={!preview || preview.count === 0 || confirming}
          >
            {confirming ? "Confirming..." : "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
