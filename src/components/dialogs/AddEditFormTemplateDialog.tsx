import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
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
import { createFormTemplate, updateFormTemplate } from "@/lib/api";
import { useAppState } from "@/lib/store";
import type { FormField, FormTemplate } from "@/types";

const FIELD_TYPES: FormField["type"][] = [
  "text",
  "email",
  "phone",
  "url",
  "textarea",
  "number",
  "date",
  "select",
  "file",
  "checkbox",
  "signature",
];

interface FieldRow {
  id: string;
  originalId?: string;
  label: string;
  type: FormField["type"];
  required: boolean;
  options: string; // comma-separated; only used when type === "select"
  helpText: string;
  prefillKey?: FormField["prefillKey"];
}

const CANONICAL_FIELDS: Array<{ key: NonNullable<FormField["prefillKey"]>; label: string }> = [
  { key: "primaryContactName", label: "Client name" },
  { key: "businessName", label: "Business name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "website", label: "Website" },
  { key: "businessDescription", label: "Business description" },
  { key: "businessType", label: "Business type" },
  { key: "assistanceRequested", label: "Assistance requested" },
  { key: "programOfInterest", label: "Program of interest" },
  { key: "budgetNeed", label: "Budget need" },
  { key: "preferredContact", label: "Preferred contact" },
  { key: "heardAboutUs", label: "How they heard about us" },
  { key: "additionalComments", label: "Additional comments" },
];

const SHARED_FIELD_IDS = new Set([
  "name", "fullName", "applicant", "business", "bizName", "brandName", "sponsor",
  "contact", "email", "phone", "website", "description", "assistance", "businessType",
  "bizType", "industry", "program", "budget", "contact_pref", "heard", "comments",
  "facebookUrl", "instagramUrl", "linkedinUrl", "tiktokUrl", "youtubeUrl",
]);

function toSlug(str: string): string {
  return (
    str
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "field"
  );
}

function rowToField(row: FieldRow): FormField {
  const field: FormField = {
    id: row.id || toSlug(row.label),
    label: row.label,
    type: row.type,
    required: row.required,
    ...(row.prefillKey ? { prefillKey: row.prefillKey } : {}),
    ...(row.helpText.trim() ? { helpText: row.helpText.trim() } : {}),
  };
  if (row.type === "select" && row.options.trim()) {
    field.options = row.options
      .split(",")
      .map((o) => o.trim())
      .filter(Boolean);
  }
  return field;
}

function fieldToRow(field: FormField): FieldRow {
  return {
    id: field.id,
    originalId: field.id,
    label: field.label,
    type: field.type,
    required: field.required,
    options: field.options?.join(", ") ?? "",
    helpText: field.helpText ?? "",
    prefillKey: field.prefillKey,
  };
}

function newRow(): FieldRow {
  return { id: "", label: "", type: "text", required: false, options: "", helpText: "" };
}

export function AddEditFormTemplateDialog({
  template,
  open,
  onOpenChange,
}: {
  template?: FormTemplate;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { programs } = useAppState();
  const isEdit = !!template;

  const [name, setName] = useState(template?.name ?? "");
  const [description, setDescription] = useState(template?.description ?? "");
  const [programId, setProgramId] = useState(template?.programId ?? "");
  const [dueInDays, setDueInDays] = useState(template?.dueInDays ?? 7);
  const [isActive, setIsActive] = useState(template?.isActive ?? true);
  const [internalNotes, setInternalNotes] = useState(template?.internalNotes ?? "");
  const [fields, setFields] = useState<FieldRow[]>(
    template ? template.fields.map(fieldToRow) : [newRow()],
  );
  const [saving, setSaving] = useState(false);

  // Re-sync state whenever the dialog opens with a (potentially new) template
  useEffect(() => {
    if (open) {
      setName(template?.name ?? "");
      setDescription(template?.description ?? "");
      setProgramId(template?.programId ?? "");
      setDueInDays(template?.dueInDays ?? 7);
      setIsActive(template?.isActive ?? true);
      setInternalNotes(template?.internalNotes ?? "");
      setFields(template ? template.fields.map(fieldToRow) : [newRow()]);
    }
  }, [open, template]);

  function updateField(idx: number, patch: Partial<FieldRow>) {
    setFields((prev) =>
      prev.map((row, i) => {
        if (i !== idx) return row;
        const updated = { ...row, ...patch };
        // Auto-generate id from label when it hasn't been manually set
        if (!updated.originalId && (!updated.id || updated.id === toSlug(row.label))) {
          updated.id = toSlug(updated.label);
        }
        return updated;
      }),
    );
  }

  function moveField(index: number, direction: -1 | 1) {
    setFields((current) => {
      const destination = index + direction;
      if (destination < 0 || destination >= current.length) return current;
      const reordered = [...current];
      [reordered[index], reordered[destination]] = [reordered[destination], reordered[index]];
      return reordered;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      toast.error("Template name is required.");
      return;
    }
    const activeFields = fields.filter((row) => row.label.trim());
    const duplicateId = activeFields.find((row, index) =>
      activeFields.findIndex((candidate) => candidate.id === row.id) !== index,
    );
    if (duplicateId) {
      toast.error(`Duplicate field ID: ${duplicateId.id}.`);
      return;
    }
    const scope = template?.scope ?? "program_section";
    if (scope === "program_section") {
      const repeated = activeFields.find((row) =>
        row.prefillKey || SHARED_FIELD_IDS.has(row.id),
      );
      if (repeated) {
        toast.error(`${repeated.label} belongs in the Master Intake form.`);
        return;
      }
    }
    if (scope === "master_core") {
      const canonicalKeys = activeFields.map((row) => row.prefillKey).filter(Boolean);
      const duplicateKey = canonicalKeys.find((key, index) => canonicalKeys.indexOf(key) !== index);
      if (duplicateKey) {
        toast.error(`The Master Intake already contains a ${duplicateKey} field.`);
        return;
      }
    }
    setSaving(true);
    try {
      const data: Omit<FormTemplate, "id"> = {
        programId: template?.scope === "master_core" ? null : programId || null,
        scope,
        version: template?.version ?? 1,
        sortOrder: template?.sortOrder ?? 0,
        name: name.trim(),
        description: description.trim(),
        dueInDays,
        isActive,
        internalNotes: internalNotes.trim() || undefined,
        emailTemplate: template?.emailTemplate ?? "default",
        fields: fields
          .filter((r) => r.label.trim())
          .map((r) => rowToField({ ...r, id: r.id || toSlug(r.label) })),
      };
      if (isEdit && template) {
        await updateFormTemplate(template.id, data);
        toast.success("Form template updated.");
      } else {
        await createFormTemplate(data);
        toast.success("Form template created.");
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
            {isEdit ? "Edit form template" : "Add form template"}
          </DialogTitle>
        </DialogHeader>

        <form id="template-form" onSubmit={handleSubmit} className="space-y-5 py-2">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-name">Template name *</Label>
            <Input
              id="tmpl-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Interest Intake Form"
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-desc">Description</Label>
            <Textarea
              id="tmpl-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="Brief description of this form…"
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            {/* Program */}
            <div className="space-y-1.5">
              <Label>Program</Label>
              <Select value={programId} onValueChange={setProgramId}>
                <SelectTrigger>
                  <SelectValue placeholder="Assign to program" />
                </SelectTrigger>
                <SelectContent>
                  {programs.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Due in days */}
            <div className="space-y-1.5">
              <Label htmlFor="tmpl-due">Due in (days after send)</Label>
              <Input
                id="tmpl-due"
                type="number"
                min={1}
                value={dueInDays}
                onChange={(e) => setDueInDays(Number(e.target.value))}
              />
            </div>
          </div>

          {/* Internal notes */}
          <div className="space-y-1.5">
            <Label htmlFor="tmpl-notes">Internal notes</Label>
            <Textarea
              id="tmpl-notes"
              value={internalNotes}
              onChange={(e) => setInternalNotes(e.target.value)}
              rows={2}
              placeholder="Staff-only notes about this form…"
            />
          </div>

          {/* Active toggle */}
          <div className="flex items-center gap-3">
            <Switch id="tmpl-active" checked={isActive} onCheckedChange={setIsActive} />
            <Label htmlFor="tmpl-active">Active</Label>
          </div>

          {/* Field builder */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Form fields</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setFields((prev) => [...prev, newRow()])}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add field
              </Button>
            </div>

            {fields.length === 0 && (
              <p className="rounded-xl border border-dashed border-border py-6 text-center text-sm text-muted-foreground">
                No fields yet. Click "Add field" to start building.
              </p>
            )}

            <div className="space-y-3">
              {fields.map((row, idx) => (
                <div key={idx} className="rounded-xl border border-border p-4 space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Question {idx + 1}
                    </p>
                    <div className="flex items-center gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={idx === 0}
                        onClick={() => moveField(idx, -1)}
                        className="h-8 w-8 text-muted-foreground"
                        aria-label={`Move ${row.label || `question ${idx + 1}`} up`}
                        title="Move question up"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        disabled={idx === fields.length - 1}
                        onClick={() => moveField(idx, 1)}
                        className="h-8 w-8 text-muted-foreground"
                        aria-label={`Move ${row.label || `question ${idx + 1}`} down`}
                        title="Move question down"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[1fr_140px_auto_auto] items-end">
                    <div className="space-y-1">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Label
                      </p>
                      <Input
                        value={row.label}
                        onChange={(e) => updateField(idx, { label: e.target.value })}
                        placeholder="Field label…"
                      />
                    </div>
                    <div className="space-y-1">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Type
                      </p>
                      <Select
                        value={row.type}
                        onValueChange={(v) => updateField(idx, { type: v as FormField["type"] })}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {FIELD_TYPES.map((t) => (
                            <SelectItem key={t} value={t}>
                              {t}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <label className="flex cursor-pointer items-center gap-1.5 pb-1.5 text-sm whitespace-nowrap">
                      <input
                        type="checkbox"
                        className="accent-primary"
                        checked={row.required}
                        onChange={(e) => updateField(idx, { required: e.target.checked })}
                      />
                      Required
                    </label>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => setFields((prev) => prev.filter((_, i) => i !== idx))}
                      className="h-8 w-8 text-muted-foreground hover:text-destructive self-end"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>

                  {(template?.scope ?? "program_section") === "master_core" && (
                    <div className="space-y-1">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Shared profile source
                      </p>
                      <Select
                        value={row.prefillKey ?? "custom"}
                        onValueChange={(value) => {
                          if (value === "custom") {
                            updateField(idx, { prefillKey: undefined });
                            return;
                          }
                          const selected = CANONICAL_FIELDS.find((field) => field.key === value)!;
                          updateField(idx, {
                            id: row.originalId ?? selected.key,
                            label: row.label || selected.label,
                            prefillKey: selected.key,
                          });
                        }}
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="custom">Custom question</SelectItem>
                          {CANONICAL_FIELDS.map((field) => (
                            <SelectItem key={field.key} value={field.key}>
                              {field.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {row.type === "select" && (
                    <div className="space-y-1">
                      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Options (comma-separated)
                      </p>
                      <Input
                        value={row.options}
                        onChange={(e) => updateField(idx, { options: e.target.value })}
                        placeholder="Option A, Option B, Option C"
                      />
                    </div>
                  )}

                  <div className="space-y-1">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Supporting text
                    </p>
                    <Textarea
                      value={row.helpText}
                      onChange={(event) => updateField(idx, { helpText: event.target.value })}
                      rows={2}
                      placeholder="Optional guidance shown below this field"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button form="template-form" type="submit" disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Create template"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
