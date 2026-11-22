import { useEffect, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cfListOpenBillingPeriods, cfRecordPastPayment, cfRecordPayment } from "@/lib/apiClient";
import { isDefinitiveFailure, newIdempotencyKey } from "@/lib/client-send";
import type { OpenBillingPeriod, PaymentMethod, PaymentRecord } from "@/types";

const METHODS: PaymentMethod[] = ["cash", "check", "ach", "card", "other"];

const periodKey = (period: Pick<OpenBillingPeriod, "billingPeriodStart" | "billingPeriodEnd">) =>
  `${period.billingPeriodStart}|${period.billingPeriodEnd}`;

const monthLabel = (date: string) =>
  new Date(date).toLocaleDateString(undefined, { month: "short", year: "numeric" });

/**
 * Records money a client paid, in one of two ways:
 * - against a billing period on the payment schedule ("Applies to period"), which marks that
 *   period paid and lowers what is outstanding; or
 * - as a past payment ("This is a past payment"): money received before ClientFlow or outside the
 *   schedule. It counts as collected but is applied to no period, so it never changes what the
 *   agreement says is owed. Without a payment agreement this is the only option.
 * Either way it is an immutable ledger entry; corrections are made by voiding.
 */
export function RecordPaymentDialog({
  open,
  onOpenChange,
  clientId,
  enrollmentId,
  hasAgreement,
  agreementAmount,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  enrollmentId: string;
  /** Whether the enrollment has an active payment agreement (a schedule to apply payments to). */
  hasAgreement: boolean;
  agreementAmount: number;
  onSaved: (payment: PaymentRecord) => void;
}) {
  const [isPast, setIsPast] = useState(!hasAgreement);
  /** Every period the schedule offers (paid ones included, to explain an empty choice). */
  const [periods, setPeriods] = useState<OpenBillingPeriod[]>([]);
  const [loadingPeriods, setLoadingPeriods] = useState(false);
  const [selectedPeriodKey, setSelectedPeriodKey] = useState<string>("");
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState(localToday());
  const [method, setMethod] = useState<PaymentMethod>("ach");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // One key per payment being entered: kept across a retry after a dropped connection (and across
  // switching between scheduled and past, which share the same key check on the server), so the
  // payment can't be recorded twice; cleared once the server has answered.
  const attemptKey = useRef<string | null>(null);
  const inFlight = useRef(false);
  const today = localToday();

  useEffect(() => {
    if (!open) return;
    attemptKey.current = null;
    setIsPast(!hasAgreement);
    setAmount(hasAgreement && agreementAmount > 0 ? String(agreementAmount) : "");
    setPaymentDate(localToday());
    setMethod(hasAgreement ? "ach" : "check");
    setNote("");
    setPeriods([]);
    setSelectedPeriodKey("");
    if (!hasAgreement) return;
    setLoadingPeriods(true);
    void cfListOpenBillingPeriods(clientId, enrollmentId)
      .then((all) => {
        setPeriods(all);
        const firstOpen = all.find((period) => period.status !== "paid");
        setSelectedPeriodKey(firstOpen ? periodKey(firstOpen) : "");
      })
      .catch((error: unknown) => {
        toast.error(
          error instanceof Error ? error.message : "Unable to load open billing periods.",
        );
      })
      .finally(() => setLoadingPeriods(false));
  }, [open, clientId, enrollmentId, hasAgreement, agreementAmount]);

  const openPeriods = periods.filter((period) => period.status !== "paid");
  const lastPaid = [...periods].reverse().find((period) => period.status === "paid");
  const amountValue = Number(amount);
  const futureDate = Boolean(paymentDate) && paymentDate > today;
  const ready =
    amountValue > 0 &&
    Boolean(paymentDate) &&
    !futureDate &&
    (isPast || Boolean(selectedPeriodKey));

  async function handleSave() {
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    setSaving(true);
    try {
      attemptKey.current ??= newIdempotencyKey();
      const base = {
        amount: amountValue,
        paymentDate, // a calendar day; the server reads it in the organization's timezone
        paymentMethod: method,
        note: note.trim() || undefined,
      };
      let payment: PaymentRecord;
      if (isPast) {
        payment = await cfRecordPastPayment(clientId, enrollmentId, base, attemptKey.current);
      } else {
        const [billingPeriodStart, billingPeriodEnd] = selectedPeriodKey.split("|");
        payment = await cfRecordPayment(
          clientId,
          enrollmentId,
          { ...base, billingPeriodStart, billingPeriodEnd },
          attemptKey.current,
        );
      }
      attemptKey.current = null;
      toast.success(isPast ? "Past payment recorded." : "Payment recorded.");
      onOpenChange(false);
      onSaved(payment);
    } catch (error) {
      if (isDefinitiveFailure(error)) attemptKey.current = null;
      toast.error(error instanceof Error ? error.message : "Unable to record the payment.");
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Record payment</DialogTitle>
          <DialogDescription>
            Saved as a permanent ledger entry. Corrections are made by voiding, not editing.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex items-start gap-2 rounded-md border border-border p-3 sm:col-span-2">
            <Checkbox
              id="record-payment-is-past"
              checked={isPast}
              disabled={!hasAgreement}
              onCheckedChange={(checked) => setIsPast(checked === true)}
            />
            <Label htmlFor="record-payment-is-past" className="text-sm font-normal leading-snug">
              <span className="font-medium">This is a past payment.</span> Money received before
              ClientFlow or outside the payment schedule. It counts as collected but isn&apos;t
              applied to a billing period.
              {!hasAgreement && (
                <span className="mt-1 block text-muted-foreground">
                  No payment schedule yet, so this is saved as a past payment.
                </span>
              )}
            </Label>
          </div>

          {!isPast && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="record-payment-period">Applies to period</Label>
              {loadingPeriods ? (
                <p className="text-sm text-muted-foreground">Loading periods…</p>
              ) : openPeriods.length > 0 ? (
                <Select value={selectedPeriodKey} onValueChange={setSelectedPeriodKey}>
                  <SelectTrigger id="record-payment-period" aria-label="Applies to period">
                    <SelectValue placeholder="Select a period" />
                  </SelectTrigger>
                  <SelectContent>
                    {openPeriods.map((period) => (
                      <SelectItem key={periodKey(period)} value={periodKey(period)}>
                        {monthLabel(period.dueDate)}
                        {period.status === "overdue"
                          ? " (overdue)"
                          : period.status === "partial"
                            ? " (partly paid)"
                            : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <div role="status" className="space-y-2 rounded-md bg-muted/40 p-3 text-sm">
                  <p>
                    {lastPaid
                      ? `Every period on the schedule through ${monthLabel(lastPaid.dueDate)} is already paid.`
                      : "There's no billing period to apply this to."}
                  </p>
                  <Button type="button" size="sm" variant="outline" onClick={() => setIsPast(true)}>
                    Record it as a past payment instead
                  </Button>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Which billing period on the schedule this payment covers. That period will show as
                paid.
              </p>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="record-payment-amount">Amount</Label>
            <Input
              id="record-payment-amount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="record-payment-date">Date paid</Label>
            <Input
              id="record-payment-date"
              type="date"
              max={today}
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select value={method} onValueChange={(v) => setMethod(v as PaymentMethod)}>
              <SelectTrigger aria-label="Payment method">
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
            <Label htmlFor="record-payment-note">Note (optional)</Label>
            <Textarea
              id="record-payment-note"
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isPast ? "e.g. March workshop fee, paid by check" : "Optional"}
            />
          </div>
          {futureDate && (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              A payment can&apos;t be dated in the future.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving || !ready}>
            {saving ? "Saving…" : isPast ? "Record past payment" : "Record payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
