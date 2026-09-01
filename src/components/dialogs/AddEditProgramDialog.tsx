import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { X } from "lucide-react";
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
import { CLIENT_STATUSES } from "@/types";
import type { ClientStatus, ContractType, MonitoringFrequency, Program } from "@/types";

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

function TagListEditor({
  label,
  items,
  onChange,
  placeholder,
}: {
  label: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  function add() {
    const val = draft.trim();
    if (!val) return;
    onChange([...items, val]);
    setDraft("");
  }

  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      <div className="flex gap-2">
        <Input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder={placeholder}
          className="flex-1"
        />
        <Button type="button" variant="outline" size="sm" onClick={add}>
          Add
        </Button>
      </div>
      {items.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {items.map((item, idx) => (
            <span
              key={idx}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs font-medium"
            >
              {item}
              <button
                type="button"
                onClick={() => onChange(items.filter((_, i) => i !== idx))}
                className="ml-0.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

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
  const eligibleFormTemplates = formTemplates.filter((template) =>
    template.isActive
    && template.scope !== "master_core"
    && (template.programId === null || template.programId === program?.id),
  );

  const [name, setName] = useState(program?.name ?? "");
  const [description, setDescription] = useState(program?.description ?? "");
  const [isActive, setIsActive] = useState(program?.isActive ?? true);
  const [defaultFormTemplateId, setDefaultFormTemplateId] = useState(
    program?.defaultFormTemplateId ?? "",
  );
  const [defaultMonitoringFrequency, setDefaultMonitoringFrequency] =
    useState<MonitoringFrequency>(program?.defaultMonitoringFrequency ?? "Monthly");
  const [defaultContractTemplateId, setDefaultContractTemplateId] = useState<ContractType>(
    program?.defaultContractTemplateId ?? "Service Agreement",
  );
  const [defaultWorkflow, setDefaultWorkflow] = useState<string[]>(
    program?.defaultWorkflow ?? [],
  );
  const [requiredDocuments, setRequiredDocuments] = useState<string[]>(
    program?.requiredDocuments ?? [],
  );
  const [statusPipeline, setStatusPipeline] = useState<ClientStatus[]>(
    program?.statusPipeline ?? [],
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
      setDefaultWorkflow(program?.defaultWorkflow ?? []);
      setRequiredDocuments(program?.requiredDocuments ?? []);
      setStatusPipeline(program?.statusPipeline ?? []);
    }
  }, [open, program]);

  function toggleStatus(status: ClientStatus) {
    setStatusPipeline((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
    );
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Program name is required.");
      return;
    }
    if (!defaultFormTemplateId) {
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
        defaultWorkflow,
        requiredDocuments,
        statusPipeline,
      };
      if (isEdit && program) {
        await updateProgram(program.id, data);
        toast.success("Program updated.");
      } else {
        await createProgram(data);
        toast.success("Program created.");
      }
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">
            {isEdit ? "Edit program" : "Add program"}
          </DialogTitle>
        </DialogHeader>

        <form id="program-form" onSubmit={handleSubmit} className="space-y-5 py-2">
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
              <Label>Default form template</Label>
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

            {/* Monitoring Frequency */}
            <div className="space-y-1.5">
              <Label>Monitoring frequency</Label>
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

            {/* Contract Template */}
            <div className="space-y-1.5">
              <Label>Contract template</Label>
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

            {/* Active toggle */}
            <div className="flex items-center gap-3 pt-6">
              <Switch id="prog-active" checked={isActive} onCheckedChange={setIsActive} />
              <Label htmlFor="prog-active">Active</Label>
            </div>
          </div>

          {/* Workflow steps */}
          <TagListEditor
            label="Default workflow steps"
            items={defaultWorkflow}
            onChange={setDefaultWorkflow}
            placeholder="e.g. Intake"
          />

          {/* Required documents */}
          <TagListEditor
            label="Required documents"
            items={requiredDocuments}
            onChange={setRequiredDocuments}
            placeholder="e.g. Signed agreement"
          />

          {/* Status pipeline */}
          <div className="space-y-2">
            <Label>Status pipeline</Label>
            <p className="text-xs text-muted-foreground">
              Check statuses to include them. Order of selection is preserved.
            </p>
            <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              {CLIENT_STATUSES.map((s) => (
                <label
                  key={s}
                  className="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm hover:bg-muted has-checked:border-primary has-checked:bg-primary/5"
                >
                  <input
                    type="checkbox"
                    className="accent-primary"
                    checked={statusPipeline.includes(s)}
                    onChange={() => toggleStatus(s)}
                  />
                  {s}
                </label>
              ))}
            </div>
            {statusPipeline.length > 0 && (
              <p className="text-xs text-muted-foreground">
                Pipeline: {statusPipeline.join(" → ")}
              </p>
            )}
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
