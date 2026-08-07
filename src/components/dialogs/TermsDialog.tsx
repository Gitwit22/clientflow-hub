import { useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createTerms } from "@/lib/api";
import type { Client, MonitoringFrequency, SupportType } from "@/types";

const SUPPORT_TYPES: SupportType[] = [
  "Service",
  "Grant",
  "Loan",
  "Forgivable Loan",
  "Investment",
  "Sponsorship",
  "Mixed Support",
  "Other",
];

const FREQUENCIES: MonitoringFrequency[] = ["Weekly", "Biweekly", "Monthly", "Quarterly", "Custom"];

export function TermsDialog({
  client,
  open,
  onOpenChange,
}: {
  client: Client | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [supportType, setSupportType] = useState<SupportType>("Grant");
  const [frequency, setFrequency] = useState<MonitoringFrequency>("Monthly");
  const [repayment, setRepayment] = useState(false);
  const [amounts, setAmounts] = useState({
    fundingAmount: "",
    grantAmount: "",
    loanAmount: "",
    investmentAmount: "",
    forgivableAmount: "",
  });
  const [text, setText] = useState({
    resourceDescription: "",
    repaymentSchedule: "",
    interestDescription: "",
    milestones: "",
    reportingRequirements: "",
    specialConditions: "",
    startDate: new Date().toISOString().slice(0, 10),
    endDate: new Date(Date.now() + 180 * 864e5).toISOString().slice(0, 10),
  });

  const num = (v: string) => Number(v || 0);

  async function handleSave() {
    if (!client) return;
    await createTerms(client.id, {
      programId: client.programId ?? "",
      supportType,
      fundingAmount: num(amounts.fundingAmount),
      grantAmount: num(amounts.grantAmount),
      loanAmount: num(amounts.loanAmount),
      investmentAmount: num(amounts.investmentAmount),
      forgivableAmount: num(amounts.forgivableAmount),
      repaymentRequired: repayment,
      repaymentSchedule: text.repaymentSchedule,
      interestDescription: text.interestDescription,
      resourceDescription: text.resourceDescription,
      milestones: text.milestones,
      reportingRequirements: text.reportingRequirements,
      startDate: new Date(text.startDate).toISOString(),
      endDate: new Date(text.endDate).toISOString(),
      monitoringFrequency: frequency,
      specialConditions: text.specialConditions,
      approvalStatus: "Pending",
    });
    toast.success("Terms created and sent for internal approval");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-display">Create funding & service terms</DialogTitle>
          <DialogDescription>
            Terms feed directly into contract generation and monitoring schedules.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Support type</Label>
            <Select value={supportType} onValueChange={(v) => setSupportType(v as SupportType)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SUPPORT_TYPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Monitoring frequency</Label>
            <Select value={frequency} onValueChange={(v) => setFrequency(v as MonitoringFrequency)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FREQUENCIES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {s}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {(
            [
              ["fundingAmount", "Funding amount"],
              ["grantAmount", "Grant amount"],
              ["loanAmount", "Loan amount"],
              ["investmentAmount", "Investment amount"],
              ["forgivableAmount", "Forgivable amount"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1.5">
              <Label>{label}</Label>
              <Input
                type="number"
                value={amounts[key]}
                placeholder="0"
                onChange={(e) => setAmounts({ ...amounts, [key]: e.target.value })}
              />
            </div>
          ))}

          <div className="flex items-center justify-between rounded-xl border border-border px-4 py-2.5">
            <Label className="mb-0">Repayment required</Label>
            <Switch checked={repayment} onCheckedChange={setRepayment} />
          </div>

          <div className="space-y-1.5">
            <Label>Start date</Label>
            <Input
              type="date"
              value={text.startDate}
              onChange={(e) => setText({ ...text, startDate: e.target.value })}
            />
          </div>
          <div className="space-y-1.5">
            <Label>End date</Label>
            <Input
              type="date"
              value={text.endDate}
              onChange={(e) => setText({ ...text, endDate: e.target.value })}
            />
          </div>

          {(
            [
              ["resourceDescription", "Resource description"],
              ["repaymentSchedule", "Repayment schedule"],
              ["interestDescription", "Interest / long-term interest"],
              ["milestones", "Milestones"],
              ["reportingRequirements", "Reporting requirements"],
              ["specialConditions", "Special conditions"],
            ] as const
          ).map(([key, label]) => (
            <div key={key} className="space-y-1.5 sm:col-span-2">
              <Label>{label}</Label>
              <Textarea
                rows={2}
                value={text[key]}
                onChange={(e) => setText({ ...text, [key]: e.target.value })}
              />
            </div>
          ))}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleSave}>Save terms</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
