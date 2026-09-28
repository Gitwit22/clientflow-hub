import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { cfVoidPayment } from "@/lib/apiClient";
import { cn } from "@/lib/utils";
import type { PaymentRecord } from "@/types";

export function PaymentLedgerDialog({
  open,
  onOpenChange,
  payments,
  onVoided,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  payments: PaymentRecord[];
  onVoided: (payment: PaymentRecord) => void;
}) {
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  async function handleVoid(payment: PaymentRecord) {
    const reason = reasonById[payment.id]?.trim();
    if (!reason) {
      toast.error("A reason is required to void a payment.");
      return;
    }
    setVoidingId(payment.id);
    try {
      const voided = await cfVoidPayment(payment.id, reason);
      toast.success("Payment voided.");
      onVoided(voided);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to void the payment.");
    } finally {
      setVoidingId(null);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Payment ledger</DialogTitle>
          <DialogDescription>Every recorded payment, including voided entries. Nothing is ever deleted.</DialogDescription>
        </DialogHeader>

        <div className="divide-y divide-border">
          {payments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No payments recorded yet.</p>
          ) : (
            payments.map((payment) => (
              <div key={payment.id} className={cn("space-y-1.5 py-3", payment.voidedAt && "opacity-60")}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className={cn("text-sm font-medium", payment.voidedAt && "line-through")}>
                    ${payment.amount.toLocaleString()} · {payment.paymentMethod.toUpperCase()} ·{" "}
                    {new Date(payment.paymentDate).toLocaleDateString()}
                  </p>
                  {payment.source === "legacy_backfill" && (
                    <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase text-muted-foreground">
                      Backfilled
                    </span>
                  )}
                </div>
                {payment.note && <p className="text-xs text-muted-foreground">{payment.note}</p>}
                {payment.voidedAt ? (
                  <p className="text-xs text-destructive">
                    Voided by {payment.voidedByDisplayName ?? "unknown"} — {payment.voidReason}
                  </p>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <Textarea
                      rows={1}
                      placeholder="Reason to void this payment"
                      className="min-h-8 flex-1"
                      value={reasonById[payment.id] ?? ""}
                      onChange={(e) => setReasonById({ ...reasonById, [payment.id]: e.target.value })}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={voidingId === payment.id}
                      onClick={() => void handleVoid(payment)}
                    >
                      {voidingId === payment.id ? "Voiding..." : "Void"}
                    </Button>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
