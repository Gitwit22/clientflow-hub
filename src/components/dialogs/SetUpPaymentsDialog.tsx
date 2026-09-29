import { useEffect, useState } from "react";
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
import { cfReplaceEnrollmentAgreement } from "@/lib/apiClient";
import type { BillingFrequency, EnrollmentBillingAgreement, ProgramBillingConfig } from "@/types";

const FREQUENCIES: BillingFrequency[] = [
  "one_time",
  "weekly",
  "monthly",
  "quarterly",
  "annually",
  "custom",
];
export type InitialPaymentStatus = "current" | "unpaid" | "partial_unknown";

export function SetUpPaymentsDialog({
  open,
  onOpenChange,
  clientId,
  enrollmentId,
  programName,
  programConfig,
  existingAgreement,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  enrollmentId: string;
  programName: string;
  programConfig: ProgramBillingConfig | null;
  existingAgreement?: EnrollmentBillingAgreement | null;
  onSaved: (
    agreement: EnrollmentBillingAgreement,
    initialPaymentStatus: InitialPaymentStatus | null,
  ) => void;
}) {
  const isReplace = !!existingAgreement;
  const [amount, setAmount] = useState("0");
  const [frequency, setFrequency] = useState<BillingFrequency>("monthly");
  const [customIntervalDays, setCustomIntervalDays] = useState("");
  const [startDate, setStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [defaultDueDay, setDefaultDueDay] = useState("1");
  const [initialPaymentStatus, setInitialPaymentStatus] = useState<InitialPaymentStatus>("unpaid");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (existingAgreement) {
      setAmount(String(existingAgreement.amount));
      setFrequency(existingAgreement.frequency);
      setCustomIntervalDays(
        existingAgreement.customIntervalDays ? String(existingAgreement.customIntervalDays) : "",
      );
      setStartDate(existingAgreement.startDate.slice(0, 10));
      setDefaultDueDay(
        existingAgreement.defaultDueDay ? String(existingAgreement.defaultDueDay) : "",
      );
    } else {
      setAmount(programConfig ? String(programConfig.defaultAmount) : "0");
      setFrequency(programConfig?.frequency ?? "monthly");
      setCustomIntervalDays(
        programConfig?.customIntervalDays ? String(programConfig.customIntervalDays) : "",
      );
      setStartDate(new Date().toISOString().slice(0, 10));
      setDefaultDueDay(programConfig?.defaultDueDay ? String(programConfig.defaultDueDay) : "1");
      setInitialPaymentStatus("unpaid");
    }
  }, [open, existingAgreement, programConfig]);

  const feeLocked = !isReplace && programConfig?.allowCustomClientPricing === false;

  async function handleSave() {
    setSaving(true);
    try {
      const agreement = await cfReplaceEnrollmentAgreement(clientId, enrollmentId, {
        amount: Number(amount || 0),
        frequency,
        customIntervalDays: customIntervalDays ? Number(customIntervalDays) : undefined,
        startDate: new Date(startDate).toISOString(),
        defaultDueDay: defaultDueDay ? Number(defaultDueDay) : undefined,
      });
      toast.success(isReplace ? "Billing agreement updated." : "Billing agreement created.");
      onOpenChange(false);
      onSaved(agreement, isReplace ? null : initialPaymentStatus);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the billing agreement.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">
            {isReplace ? "Update agreement" : "Set up payments"}
          </DialogTitle>
          <DialogDescription>
            {isReplace
              ? "Changing the fee, frequency, or start date ends the current agreement and starts a new one — past payment history is never rewritten."
              : `Program: ${programName}`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Agreed fee</Label>
            <Input
              type="number"
              min="0"
              value={amount}
              disabled={feeLocked}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label>Frequency</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as BillingFrequency)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f.replace("_", "-")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {frequency === "custom" && (
            <div className="space-y-1.5">
              <Label>Custom interval (days)</Label>
              <Input
                type="number"
                min="1"
                value={customIntervalDays}
                onChange={(e) => setCustomIntervalDays(e.target.value)}
              />
            </div>
          )}
          {["monthly", "quarterly", "annually"].includes(frequency) && (
            <div className="space-y-1.5">
              <Label>Default due day</Label>
              <Input
                type="number"
                min="1"
                max="28"
                value={defaultDueDay}
                onChange={(e) => setDefaultDueDay(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Billing start date</Label>
            <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          {!isReplace && (
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Existing payment status</Label>
              <Select
                value={initialPaymentStatus}
                onValueChange={(v) => setInitialPaymentStatus(v as InitialPaymentStatus)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="current">Current — paid through a known date</SelectItem>
                  <SelectItem value="unpaid">Unpaid — no historical payments to record</SelectItem>
                  <SelectItem value="partial_unknown">
                    Partial / unknown — I'll pick which periods were paid
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => void handleSave()} disabled={saving}>
            {saving ? "Saving..." : isReplace ? "Update agreement" : "Save agreement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
