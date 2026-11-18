import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { localToday } from "@/lib/dates";
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
import { cfRecordPastPayment } from "@/lib/apiClient";
import { isDefinitiveFailure, newIdempotencyKey } from "@/lib/client-send";
import type { PaymentMethod, PaymentRecord } from "@/types";

const METHODS: PaymentMethod[] = ["cash", "check", "ach", "card", "other"];

/**
 * Records a payment the client made in the past (for example before ClientFlow), with its real
 * date. It needs no billing agreement and is not applied to any billing period, so it never
 * changes what an agreement says is owed; it shows in the payment history and counts as collected.
 */
export function RecordPastPaymentDialog({
  open,
  onOpenChange,
  clientId,
  enrollmentId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  enrollmentId: string;
  onSaved: (payment: PaymentRecord) => void;
}) {
  const [amount, setAmount] = useState("");
  const [paymentDate, setPaymentDate] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("check");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  // One key per payment being entered, kept across a retry, so it can't be recorded twice.
  const attemptKey = useRef<string | null>(null);
  const today = localToday();

  useEffect(() => {
    if (!open) return;
    attemptKey.current = null;
    setAmount("");
    setPaymentDate("");
    setMethod("check");
    setNote("");
  }, [open]);

  const amountValue = Number(amount);
  const ready = amountValue > 0 && Boolean(paymentDate) && paymentDate <= today;

  async function handleSave() {
    if (!ready) return;
    setSaving(true);
    try {
      attemptKey.current ??= newIdempotencyKey();
      const payment = await cfRecordPastPayment(
        clientId,
        enrollmentId,
        {
          amount: amountValue,
          paymentDate, // a calendar day; the server reads it in the organization's timezone
          paymentMethod: method,
          note: note.trim() || undefined,
        },
        attemptKey.current,
      );
      attemptKey.current = null;
      toast.success("Past payment recorded.");
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
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Record past payment</DialogTitle>
          <DialogDescription>
            A payment the client already made, for example before ClientFlow. It is added to their
            payment history with its real date and doesn&apos;t change what a billing agreement says
            is owed. Corrections are made by voiding.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="past-payment-date">Date paid</Label>
            <Input
              id="past-payment-date"
              type="date"
              max={today}
              value={paymentDate}
              onChange={(event) => setPaymentDate(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="past-payment-amount">Amount</Label>
            <Input
              id="past-payment-amount"
              type="number"
              min="0.01"
              step="0.01"
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Method</Label>
            <Select value={method} onValueChange={(value) => setMethod(value as PaymentMethod)}>
              <SelectTrigger aria-label="Payment method">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {METHODS.map((item) => (
                  <SelectItem key={item} value={item}>
                    {item.toUpperCase()}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5 sm:col-span-2">
            <Label htmlFor="past-payment-note">What it was for (optional)</Label>
            <Textarea
              id="past-payment-note"
              rows={2}
              maxLength={1000}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder="e.g. March workshop fee, paid by check"
            />
          </div>
          {paymentDate > today && (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              A past payment can't be dated in the future.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready || saving} onClick={() => void handleSave()}>
            {saving ? "Saving…" : "Record past payment"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
