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
import { createProgram, createProgramFromSetup, updateProgram } from "@/lib/api";
import { newIdempotencyKey } from "@/lib/client-send";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { CopySetupPicker } from "@/components/programs/CopySetupPicker";
import { defaultCopySource, SETUP_COPY_PARTS, type SetupCopyChoice } from "@/lib/setup-copy";
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

/** The intake choice that means "general intake only, no extra questions". */
const GENERAL_INTAKE = "general-intake";

export function AddEditProgramDialog({
  program,
  open,
  onOpenChange,
}: {
  program?: Program;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { formTemplates, programs } = useAppState();
  const isEdit = !!program;
  // A program's intake is the general intake alone, or questions that belong to it (the public intake
  // never shows a form that belongs to another program or to none). A new program owns no questions
  // yet: they are added from its Program questions tab.
  const ownQuestionForms = program
    ? formTemplates.filter(
        (template) =>
          template.isActive &&
          template.scope !== "master_core" &&
          template.programId === program.id,
      )
    : [];

  const [name, setName] = useState(program?.name ?? "");
  const [description, setDescription] = useState(program?.description ?? "");
  // New programs start inactive: they are activated from the setup checklist once ready.
  const [isActive, setIsActive] = useState(program?.isActive ?? false);
  const [defaultFormTemplateId, setDefaultFormTemplateId] = useState(
    program?.defaultFormTemplateId || GENERAL_INTAKE,
  );
  const [defaultMonitoringFrequency, setDefaultMonitoringFrequency] = useState<MonitoringFrequency>(
    program?.defaultMonitoringFrequency ?? "Monthly",
  );
  const [defaultContractTemplateId, setDefaultContractTemplateId] = useState<ContractType>(
    program?.defaultContractTemplateId ?? "Service Agreement",
  );
  const [saving, setSaving] = useState(false);
  // New programs can start blank or from another program's setup (chosen parts copied).
  const [startFrom, setStartFrom] = useState<"blank" | "copy">("blank");
  const [copyChoice, setCopyChoice] = useState<SetupCopyChoice>({ sourceProgramId: "", parts: [] });
  // One key per opening of the dialog: a double click or retry creates the program once.
  const [createKey, setCreateKey] = useState(newIdempotencyKey);

  // Re-sync state whenever the dialog opens (or opens with a different program)
  useEffect(() => {
    if (open) {
      setName(program?.name ?? "");
      setDescription(program?.description ?? "");
      setIsActive(program?.isActive ?? false);
      setDefaultFormTemplateId(program?.defaultFormTemplateId || GENERAL_INTAKE);
      setDefaultMonitoringFrequency(program?.defaultMonitoringFrequency ?? "Monthly");
      setDefaultContractTemplateId(program?.defaultContractTemplateId ?? "Service Agreement");
      setStartFrom("blank");
      setCopyChoice({
        sourceProgramId: defaultCopySource(programs),
        parts: SETUP_COPY_PARTS.map((item) => item.part),
      });
      setCreateKey(newIdempotencyKey());
    }
    // `programs` only seeds the default choice when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, program]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Program name is required.");
      return;
    }
    const copying = !isEdit && startFrom === "copy";
    if (copying && (!copyChoice.sourceProgramId || copyChoice.parts.length === 0)) {
      toast.error("Choose the program to copy from and at least one part of its setup.");
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
            defaultFormTemplateId: program.defaultFormTemplateId || GENERAL_INTAKE,
            defaultMonitoringFrequency: program.defaultMonitoringFrequency,
            defaultContractTemplateId: program.defaultContractTemplateId,
          }),
        );
        toast.success("Program updated.");
      } else if (copying) {
        const source = programs.find((item) => item.id === copyChoice.sourceProgramId);
        const result = await createProgramFromSetup(
          {
            name: data.name,
            description: data.description,
            defaultMonitoringFrequency,
            defaultContractTemplateId,
            ...journeyToProgramFields(DEFAULT_JOURNEY),
            ...copyChoice,
          },
          createKey,
        );
        const skipped = result.parts.filter((part) => part.outcome === "skip").length;
        toast.success(
          `Program created from ${source?.name ?? "the chosen program"}'s setup. It is inactive: review it, then activate it from its setup checklist.${skipped ? ` ${skipped} part(s) were kept as they were.` : ""}`,
        );
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

          {!isEdit && (
            <div className="space-y-2">
              <Label>Start from</Label>
              <RadioGroup
                value={startFrom}
                onValueChange={(value) => setStartFrom(value === "copy" ? "copy" : "blank")}
                className="grid gap-2 sm:grid-cols-2"
              >
                <Label className="flex items-center gap-2 rounded-md border border-border p-2 font-normal">
                  <RadioGroupItem value="blank" aria-label="Blank program" /> A blank program
                </Label>
                <Label className="flex items-center gap-2 rounded-md border border-border p-2 font-normal">
                  <RadioGroupItem value="copy" aria-label="Copy another program's setup" /> Copy
                  another program's setup
                </Label>
              </RadioGroup>
              {startFrom === "copy" && (
                <CopySetupPicker
                  programs={programs}
                  targetProgramId={null}
                  value={copyChoice}
                  onChange={setCopyChoice}
                />
              )}
            </div>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Intake questions */}
            {(isEdit || startFrom === "blank") && (
              <div className="space-y-1.5">
                <Label>Intake questions</Label>
                <Select value={defaultFormTemplateId} onValueChange={setDefaultFormTemplateId}>
                  <SelectTrigger aria-label="Intake questions">
                    <SelectValue placeholder="Choose the intake questions" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={GENERAL_INTAKE}>General intake only</SelectItem>
                    {ownQuestionForms.map((t) => (
                      <SelectItem key={t.id} value={t.id}>
                        {t.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {!isEdit && (
                  <p className="text-xs text-muted-foreground">
                    Add this program's own questions from its Program questions tab after creating
                    it.
                  </p>
                )}
              </div>
            )}

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

            {/* Program status: a copied program always starts inactive, to be reviewed first. */}
            {(isEdit || startFrom === "blank") && (
              <div className="space-y-1.5">
                <Label htmlFor="prog-active">Status</Label>
                <div className="flex h-10 items-center gap-3">
                  <Switch id="prog-active" checked={isActive} onCheckedChange={setIsActive} />
                  <span className="text-sm">{isActive ? "Active" : "Inactive"}</span>
                </div>
                {!isEdit && (
                  <p className="text-xs text-muted-foreground">
                    Leave it inactive, finish the setup checklist on the program page, then activate
                    it there.
                  </p>
                )}
              </div>
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
