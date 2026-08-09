import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { changeAssignmentStatus, saveFormDraft, submitFormResponse } from "@/lib/api";
import { useAppState } from "@/lib/store";
import type { Client, FormAssignment, FormAssignmentStatus, FormField } from "@/types";

function prefillFromClient(field: FormField, client: Client): string {
  if (field.prefillKey) {
    const k = field.prefillKey;
    if (k === "businessDescription") return client.intake.businessDescription;
    if (k === "programOfInterest") return client.intake.programOfInterest;
    const v = client[k as keyof Client];
    if (typeof v === "string") return v;
  }
  const idMap: Record<string, string> = {
    email: client.email,
    phone: client.phone,
    business: client.businessName,
    bizName: client.businessName,
    brandName: client.businessName,
    contact: client.primaryContactName,
    fullName: client.primaryContactName,
    name: client.primaryContactName,
    website: client.website ?? "",
  };
  return idMap[field.id] ?? "";
}

const STATUS_TRANSITIONS: Partial<Record<FormAssignmentStatus, FormAssignmentStatus[]>> = {
  submitted: ["under_review", "approved", "cancelled"],
  under_review: ["approved", "cancelled"],
};

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: FormField;
  value: string;
  onChange: (v: string) => void;
}) {
  if (field.type === "textarea") {
    return (
      <Textarea
        id={`field-${field.id}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        placeholder={`Enter ${field.label.toLowerCase()}…`}
      />
    );
  }
  if (field.type === "select" && field.options?.length) {
    return (
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger id={`field-${field.id}`}>
          <SelectValue placeholder="Select…" />
        </SelectTrigger>
        <SelectContent>
          {field.options.map((opt) => (
            <SelectItem key={opt} value={opt}>
              {opt}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  if (field.type === "checkbox") {
    return (
      <div className="flex items-center gap-2">
        <Checkbox
          id={`field-${field.id}`}
          checked={value === "true"}
          onCheckedChange={(checked) => onChange(String(Boolean(checked)))}
        />
        <label htmlFor={`field-${field.id}`} className="cursor-pointer text-sm">
          I agree
        </label>
      </div>
    );
  }
  if (field.type === "file") {
    return (
      <div className="rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground">
        File upload — coming soon
      </div>
    );
  }
  return (
    <Input
      id={`field-${field.id}`}
      type={
        field.type === "phone"
          ? "tel"
          : field.type === "email"
            ? "email"
            : field.type === "number"
              ? "number"
              : field.type === "date"
                ? "date"
                : "text"
      }
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={`Enter ${field.label.toLowerCase()}…`}
    />
  );
}

interface FormRendererDialogProps {
  assignment: FormAssignment | null;
  client: Client;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** When true, fields are displayed read-only (for reviewing submitted responses). */
  readOnly?: boolean;
}

export function FormRendererDialog({
  assignment,
  client,
  open,
  onOpenChange,
  readOnly = false,
}: FormRendererDialogProps) {
  const { formTemplates } = useAppState();
  const template = assignment ? formTemplates.find((t) => t.id === assignment.formId) : null;

  const [responses, setResponses] = useState<Record<string, string>>(() => {
    if (!template) return {};
    const existing = assignment?.responses ?? {};
    if (readOnly) return existing;
    return Object.fromEntries(
      template.fields.map((f) => [f.id, existing[f.id] ?? prefillFromClient(f, client)]),
    );
  });
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [nextStatus, setNextStatus] = useState<FormAssignmentStatus | "">("");
  const [changingStatus, setChangingStatus] = useState(false);

  if (!assignment || !template) return null;

  const set = (id: string, v: string) => setResponses((prev) => ({ ...prev, [id]: v }));

  const requiredFields = template.fields.filter((f) => f.required);
  const missingRequired = requiredFields.filter((f) => !responses[f.id]?.trim());
  const completedRequired = requiredFields.length - missingRequired.length;
  const progressPct =
    requiredFields.length > 0
      ? Math.round((completedRequired / requiredFields.length) * 100)
      : 100;

  const availableStatuses = STATUS_TRANSITIONS[assignment.status] ?? [];

  async function handleSaveDraft() {
    setSaving(true);
    try {
      await saveFormDraft(assignment!.id, responses);
      toast.success("Draft saved");
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit() {
    if (missingRequired.length > 0) {
      toast.error(
        `${missingRequired.length} required field${missingRequired.length !== 1 ? "s" : ""} still empty`,
      );
      return;
    }
    setSubmitting(true);
    try {
      await submitFormResponse(assignment!.id, responses);
      toast.success("Form submitted");
      onOpenChange(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleChangeStatus() {
    if (!nextStatus) return;
    setChangingStatus(true);
    try {
      await changeAssignmentStatus(assignment!.id, nextStatus as FormAssignmentStatus);
      toast.success(`Status updated to ${nextStatus.replace(/_/g, " ")}`);
      onOpenChange(false);
    } finally {
      setChangingStatus(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">{template.name}</DialogTitle>
          <DialogDescription>
            {readOnly
              ? `Submitted responses for ${client.businessName}`
              : template.description}
          </DialogDescription>
        </DialogHeader>

        {!readOnly && requiredFields.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {completedRequired} of {requiredFields.length} required fields completed
              </span>
              <span>{progressPct}%</span>
            </div>
            <Progress value={progressPct} className="h-1.5" />
          </div>
        )}

        <div className="space-y-5">
          {template.fields.map((field) => {
            const value = responses[field.id] ?? "";
            return (
              <div key={field.id} className="space-y-1.5">
                <Label htmlFor={readOnly ? undefined : `field-${field.id}`}>
                  {field.label}
                  {!readOnly && field.required && (
                    <span className="ml-1 text-destructive" aria-hidden>
                      *
                    </span>
                  )}
                </Label>
                {readOnly ? (
                  <p className={`text-sm ${value ? "" : "italic text-muted-foreground"}`}>
                    {value || "(not answered)"}
                  </p>
                ) : (
                  <FieldInput field={field} value={value} onChange={(v) => set(field.id, v)} />
                )}
              </div>
            );
          })}
        </div>

        {readOnly && availableStatuses.length > 0 && (
          <div className="space-y-2 border-t border-border pt-4">
            <p className="text-sm font-medium">Change Status</p>
            <div className="flex items-center gap-2">
              <Select
                value={nextStatus}
                onValueChange={(v) => setNextStatus(v as FormAssignmentStatus)}
              >
                <SelectTrigger className="w-48">
                  <SelectValue placeholder="Select new status…" />
                </SelectTrigger>
                <SelectContent>
                  {availableStatuses.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleChangeStatus}
                disabled={!nextStatus || changingStatus}
              >
                {changingStatus ? "Updating…" : "Update"}
              </Button>
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Close
          </Button>
          {!readOnly && (
            <div className="flex gap-2">
              <Button variant="outline" onClick={handleSaveDraft} disabled={saving || submitting}>
                {saving ? "Saving…" : "Save Draft"}
              </Button>
              <Button onClick={handleSubmit} disabled={saving || submitting}>
                {submitting ? "Submitting…" : "Submit Form"}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
