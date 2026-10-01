import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { createProgram, updateProgram } from "@/lib/api";
import { useAppState } from "@/lib/store";
import { DEFAULT_JOURNEY, journeyToProgramFields } from "@/lib/program-journey";
import type { ContractType, MonitoringFrequency, Program } from "@/types";
import { changedFields } from "@/lib/changed-fields";

const MONITORING_FREQUENCIES: MonitoringFrequency[] = [
  "Weekly",
  "Biweekly",
  "Monthly",
  "Quarterly",
  "Custom",
];

const CONTRACT_TYPES: ContractType[] = [
  "Service Agreement",
  "Grant Agreement",
  "Loan Agreement",
  "Forgivable Loan Agreement",
  "Investment Terms",
  "Sponsorship Agreement",
  "Event Planning Agreement",
  "Workshop Agreement",
  "Membership Agreement",
  "Partnership Agreement",
];

export function AddEditProgramDialog({
  program,
  open,
  onOpenChange,
}: {
  program?: Program;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { formTemplates } = useAppState();
  const isEdit = !!program;
  const eligibleFormTemplates = formTemplates.filter(
    (template) =>
      template.isActive &&
      template.scope !== "master_core" &&
      (template.programId === null || template.programId === program?.id),
  );

  const [name, setName] = useState(program?.name ?? "");
  const [description, setDescription] = useState(program?.description ?? "");
  const [isActive, setIsActive] = useState(program?.isActive ?? true);
  const [defaultFormTemplateId, setDefaultFormTemplateId] = useState(
    program?.defaultFormTemplateId ?? "",
  );
  const [defaultMonitoringFrequency, setDefaultMonitoringFrequency] = useState<MonitoringFrequency>(
    program?.defaultMonitoringFrequency ?? "Monthly",
  );
  const [defaultContractTemplateId, setDefaultContractTemplateId] = useState<ContractType>(
    program?.defaultContractTemplateId ?? "Service Agreement",
  );
  const [saving, setSaving] = useState(false);

  // Re-sync state whenever the dialog opens (or opens with a different program)
  useEffect(() => {
    if (open) {
      setName(program?.name ?? "");
      setDescription(program?.description ?? "");
      setIsActive(program?.isActive ?? true);
      setDefaultFormTemplateId(program?.defaultFormTemplateId ?? "");
      setDefaultMonitoringFrequency(program?.defaultMonitoringFrequency ?? "Monthly");
      setDefaultContractTemplateId(program?.defaultContractTemplateId ?? "Service Agreement");
    }
  }, [open, program]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Program name is required.");
      return;
    }
    const formTemplateChanged = defaultFormTemplateId !== (program?.defaultFormTemplateId ?? "");
    // A saved program may point at a template that no longer exists; that only blocks a save when
    // staff are actually choosing the template.
    if (!defaultFormTemplateId && (!isEdit || formTemplateChanged)) {
      toast.error("Choose a default form template.");
      return;
    }
    setSaving(true);
    try {
      const data = {
        name: name.trim(),
        description: description.trim(),
        isActive,
        defaultFormTemplateId,
        defaultMonitoringFrequency,
        defaultContractTemplateId,
      };
      // Workflow, required documents and the status pipeline are edited on the program page;
      // an edit here leaves them untouched.
      if (isEdit && program) {
        // Only what changed is sent, so an untouched value the server would refuse never blocks a save.
        await updateProgram(
          program.id,
          changedFields(data, {
            name: program.name,
            description: program.description ?? "",
            isActive: program.isActive,
            defaultFormTemplateId: program.defaultFormTemplateId ?? "",
            defaultMonitoringFrequency: program.defaultMonitoringFrequency,
            defaultContractTemplateId: program.defaultContractTemplateId,
          }),
        );
        toast.success("Program updated.");
      } else {
        await createProgram({
          ...data,
          ...journeyToProgramFields(DEFAULT_JOURNEY),
          requiredDocuments: [],
        });
        toast.success("Program created.");
      }
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof Error && error.message ? error.message : "Unable to save this program.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">
            {isEdit ? "Edit program" : "Add program"}
          </DialogTitle>
        </DialogHeader>

        <form id="program-form" onSubmit={handleSubmit} className="space-y-4 py-1">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="prog-name">Program name *</Label>
            <Input
              id="prog-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Brand Awareness Subscription"
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="prog-desc">Description</Label>
            <Textarea
              id="prog-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Brief overview of what this program covers…"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Default Form Template */}
            <div className="space-y-1.5">
              <Label>Default form</Label>
              <Select value={defaultFormTemplateId} onValueChange={setDefaultFormTemplateId}>
                <SelectTrigger>
                  <SelectValue placeholder="Choose a form" />
                </SelectTrigger>
                <SelectContent>
                  {eligibleFormTemplates.map((t) => (
                    <SelectItem key={t.id} value={t.id}>
                      {t.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Contract */}
            <div className="space-y-1.5">
              <Label>Contract</Label>
              <Select
                value={defaultContractTemplateId}
                onValueChange={(v) => setDefaultContractTemplateId(v as ContractType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONTRACT_TYPES.map((c) => (
                    <SelectItem key={c} value={c}>
                      {c}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Monitoring */}
            <div className="space-y-1.5">
              <Label>Monitoring</Label>
              <Select
                value={defaultMonitoringFrequency}
                onValueChange={(v) => setDefaultMonitoringFrequency(v as MonitoringFrequency)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONITORING_FREQUENCIES.map((f) => (
                    <SelectItem key={f} value={f}>
                      {f}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Program status */}
            <div className="space-y-1.5">
              <Label htmlFor="prog-active">Status</Label>
              <div className="flex h-10 items-center gap-3">
                <Switch id="prog-active" checked={isActive} onCheckedChange={setIsActive} />
                <span className="text-sm">{isActive ? "Active" : "Inactive"}</span>
              </div>
            </div>
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button form="program-form" type="submit" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create program"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
