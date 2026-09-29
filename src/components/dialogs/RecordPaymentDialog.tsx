import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cfListOpenBillingPeriods, cfRecordPayment } from "@/lib/apiClient";
import { isDefinitiveFailure, newIdempotencyKey } from "@/lib/client-send";
import type { OpenBillingPeriod, PaymentMethod, PaymentRecord } from "@/types";

const METHODS: PaymentMethod[] = ["cash", "check", "ach", "card", "other"];

export function RecordPaymentDialog({
  open,
  onOpenChange,
  clientId,
  enrollmentId,
  agreementAmount,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  enrollmentId: string;
  agreementAmount: number;
  onSaved: (payment: PaymentRecord) => void;
}) {
  const [periods, setPeriods] = useState<OpenBillingPeriod[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string>("");
  const [amount, setAmount] = useState(String(agreementAmount));
  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [method, setMethod] = useState<PaymentMethod>("ach");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // One key per payment being entered: kept across a retry after a dropped connection, so the
  // payment can't be recorded twice; cleared once the server has answered.
  const attemptKey = useRef<string | null>(null);

  useEffect(() => {
    if (!open) return;
    attemptKey.current = null;
    setAmount(String(agreementAmount));
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setNote("");
    setLoadingPeriods(true);
    void cfListOpenBillingPeriods(clientId, enrollmentId)
      .then((all) => {
        const openOnes = all.filter((p) => p.status !== "paid");
        setPeriods(openOnes);
        setSelectedPeriodKey(
          openOnes[0] ? `${openOnes[0].billingPeriodStart}|${openOnes[0].billingPeriodEnd}` : "",
        );
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Unable to load open billing periods.",
        );
      })
      .finally(() => setLoadingPeriods(false));
  }, [open, clientId, enrollmentId, agreementAmount]);

  async function handleSave() {
    const [billingPeriodStart, billingPeriodEnd] = selectedPeriodKey.split("|");
    if (!billingPeriodStart || !billingPeriodEnd) {
      toast.error("Select which billing period this payment applies to.");
      return;
    }
    setSaving(true);
    try {
      attemptKey.current ??= newIdempotencyKey();
      const payment = await cfRecordPayment(
        clientId,
        enrollmentId,
        {
          amount: Number(amount || 0),
          paymentDate: new Date(paymentDate).toISOString(),
          paymentMethod: method,
          billingPeriodStart,
          billingPeriodEnd,
          note: note || undefined,
        },
        attemptKey.current,
      );
      attemptKey.current = null;
      toast.success("Payment recorded.");
      onOpenChange(false);
      onSaved(payment);
    } catch (error) {
      if (isDefinitiveFailure(error)) attemptKey.current = null;
      toast.error(error instanceof Error ? error.message : "Unable to record the payment.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Record payment</DialogTitle>
          <DialogDescription>
            Saved as an immutable ledger entry — corrections are made by voiding, not editing.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Applies to period</Label>
            <Select
              value={selectedPeriodKey}
              onValueChange={setSelectedPeriodKey}
              disabled={loadingPeriods}
            >
              <SelectTrigger>
                <SelectValue
                  placeholder={loadingPeriods ? "Loading periods..." : "Select a period"}
                />
              </SelectTrigger>
              <SelectContent>
                {periods.map((period) => {
                  const key = `${period.billingPeriodStart}|${period.billingPeriodEnd}`;
                  return (
                    <SelectItem key={key} value={key}>
                      {new Date(period.dueDate).toLocaleDateString(undefined, {
                        month: "short",
                        year: "numeric",
                      })}
                      {period.status === "overdue"
                        ? " (overdue)"
                        : period.status === "partial"
                          ? " (partial)"
                          : ""}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Amount</Label>
            <Input
              type="number"
              min="0.01"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Payment date</Label>
            <Input
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label>Note</Label>
            <Textarea
              rows={2}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Optional"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || !selectedPeriodKey}>
            {saving ? "Saving..." : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
