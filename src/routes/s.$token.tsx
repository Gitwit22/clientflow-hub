import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  getPublicForm,
  submitPublicForm,
  ApiError,
  type PublicFormData,
  type PublicFormField,
  type PublicFormResponseValue,
  type PublicFormSection,
} from "@/lib/apiClient";

export const Route = createFileRoute("/s/$token")({
  head: () => ({
    meta: [{ title: "Complete your form" }],
  }),
  component: PublicFormPage,
});

type PageStatus =
  | "loading"
  | "ready"
  | "submitting"
  | "success"
  | "error"
  | "not_found"
  | "already_submitted";

function PublicFormPage() {
  const { token } = Route.useParams();
  const [status, setStatus] = useState<PageStatus>("loading");
  const [formData, setFormData] = useState<PublicFormData | null>(null);
  const [responses, setResponses] = useState<Record<string, PublicFormResponseValue>>({});
  const [selectedProgramIds, setSelectedProgramIds] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [startedAt] = useState(() => new Date().toISOString());
  const [idempotencyKey] = useState(() => globalThis.crypto.randomUUID());

  useEffect(() => {
    getPublicForm(token)
      .then((data) => {
        setFormData(data);
        const initial: Record<string, PublicFormResponseValue> = {};
        for (const section of data.intakeConfiguration.sections) {
          for (const field of section.fields) {
            initial[field.id] = data.prefill[field.id] ?? "";
          }
        }
        setResponses(initial);
        if (["submitted", "approved"].includes(data.assignment.status)) {
          setStatus("already_submitted");
        } else {
          setStatus("ready");
        }
      })
      .catch((err: { status?: number } | null) => {
        if (err && err.status === 404) {
          setStatus("not_found");
        } else {
          setErrorMsg("Unable to load the form. Please try again or contact us directly.");
          setStatus("error");
        }
      });
  }, [token]);

  const set = (id: string, value: PublicFormResponseValue) =>
    setResponses((prev) => ({ ...prev, [id]: value }));

  const toggleProgram = (programId: string, checked: boolean) => {
    setSelectedProgramIds((current) => checked
      ? [...current, programId]
      : current.filter((id) => id !== programId));
  };

  async function handleSubmit() {
    if (!formData) return;
    if (selectedProgramIds.length === 0) {
      toast.error("Select at least one program.");
      return;
    }
    const visibleSections = getVisibleSections(formData, selectedProgramIds);
    const missing = visibleSections
      .flatMap((section) => section.fields)
      .filter((field) => field.required && isBlank(responses[field.id]))
      .map((f) => f.label);

    if (missing.length > 0) {
      toast.error(
        `Please complete: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` (+${missing.length - 3} more)` : ""}`,
      );
      return;
    }

    setStatus("submitting");
    try {
      await submitPublicForm(token, {
        responses,
        selectedProgramIds,
        configurationToken: formData.intakeConfiguration.configurationToken,
        idempotencyKey,
        startedAt,
      });
      setStatus("success");
    } catch (error) {
      setStatus("ready");
      toast.error(
        error instanceof ApiError ? error.message : "Submission failed. Please try again.",
      );
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────
  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading your form…</p>
      </div>
    );
  }

  // ── Not found ────────────────────────────────────────────────────────────
  if (status === "not_found") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="text-xl font-semibold">Link not found</h1>
          <p className="text-sm text-muted-foreground">
            This form link is invalid or has expired. Please contact us if you need a new link.
          </p>
        </div>
      </div>
    );
  }

  // ── Error ────────────────────────────────────────────────────────────────
  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">{errorMsg}</p>
        </div>
      </div>
    );
  }

  // ── Already submitted ────────────────────────────────────────────────────
  if (status === "already_submitted") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="text-xl font-semibold">Already submitted</h1>
          <p className="text-sm text-muted-foreground">
            This form has already been submitted. Thank you!
          </p>
        </div>
      </div>
    );
  }

  // ── Success ──────────────────────────────────────────────────────────────
  if (status === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-4 text-center">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-primary">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="32"
              height="32"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
          <h1 className="font-display text-2xl font-semibold">Form submitted!</h1>
          <p className="text-muted-foreground">
            Thank you, {formData?.contact.name}. Your {formData?.form.name} has been received. A
            team member will be in touch soon.
          </p>
        </div>
      </div>
    );
  }

  // ── Form ─────────────────────────────────────────────────────────────────
  if (!formData) return null;

  const visibleSections = getVisibleSections(formData, selectedProgramIds);
  const requiredFields = visibleSections
    .flatMap((section) => section.fields)
    .filter((field) => field.required);
  const completed = requiredFields.filter((field) => !isBlank(responses[field.id])).length;
  const progressPct =
    requiredFields.length > 0 ? Math.round((completed / requiredFields.length) * 100) : 100;

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="mx-auto max-w-2xl space-y-8">
        {/* Header */}
        <div className="space-y-1">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {formData.program.name}
          </p>
          <h1 className="font-display text-2xl font-semibold">{formData.form.name}</h1>
          {formData.form.description && (
            <p className="text-sm text-muted-foreground">{formData.form.description}</p>
          )}
          {formData.assignment.dueDate && (
            <p className="text-xs text-muted-foreground">
              Due: {new Date(formData.assignment.dueDate).toLocaleDateString()}
            </p>
          )}
        </div>

        {/* Progress */}
        {requiredFields.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>
                {completed} of {requiredFields.length} required fields completed
              </span>
              <span>{progressPct}%</span>
            </div>
            <Progress value={progressPct} className="h-1.5" />
          </div>
        )}

        <fieldset className="space-y-3 border-y border-border py-5">
          <legend className="px-1 text-sm font-semibold">Select programs</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {formData.intakeConfiguration.programs.map((program) => {
              const checked = selectedProgramIds.includes(program.id);
              return (
                <label
                  key={program.id}
                  className="flex cursor-pointer items-center gap-3 rounded-md border border-border p-3 text-sm"
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(value) => toggleProgram(program.id, value === true)}
                    disabled={status === "submitting"}
                  />
                  <span>{program.name}</span>
                </label>
              );
            })}
          </div>
        </fieldset>

        {/* Core and selected-program fields */}
        <div className="space-y-8">
          {visibleSections.map((section) => (
            <section key={section.id} className="space-y-5" aria-labelledby={`section-${section.id}`}>
              <div className="space-y-1 border-b border-border pb-3">
                <h2 id={`section-${section.id}`} className="font-display text-lg font-semibold">
                  {section.title}
                </h2>
                {section.description && (
                  <p className="text-sm text-muted-foreground">{section.description}</p>
                )}
              </div>
              {section.fields.map((field) => (
                <div key={`${section.id}:${field.id}`} className="space-y-1.5">
                  <Label htmlFor={`field-${field.id}`}>
                    {field.label}
                    {field.required && <span className="ml-1 text-destructive">*</span>}
                  </Label>
                  <PublicFieldInput
                    field={field}
                    value={typeof responses[field.id] === "string" ? responses[field.id] : ""}
                    onChange={(value) => set(field.id, value)}
                    disabled={status === "submitting"}
                  />
                </div>
              ))}
            </section>
          ))}
        </div>

        {/* Submit */}
        <div className="flex justify-end border-t border-border pt-6">
          <Button onClick={handleSubmit} disabled={status === "submitting"} size="lg">
            {status === "submitting" ? "Submitting…" : "Submit form"}
          </Button>
        </div>
      </div>
    </div>
  );
}

function getVisibleSections(
  formData: PublicFormData,
  selectedProgramIds: string[],
): PublicFormSection[] {
  const selected = new Set(selectedProgramIds);
  return formData.intakeConfiguration.sections.filter(
    (section) => section.kind === "core"
      || (section.programId !== null && selected.has(section.programId)),
  );
}

function isBlank(value: PublicFormResponseValue | undefined): boolean {
  return value === undefined
    || value === null
    || (typeof value === "string" && value.trim().length === 0)
    || (Array.isArray(value) && value.length === 0);
}

function PublicFieldInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: PublicFormField;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  if (field.type === "textarea") {
    return (
      <Textarea
        id={`field-${field.id}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={3}
        disabled={disabled}
        placeholder="Enter your answer…"
      />
    );
  }
  if (field.type === "select" && field.options?.length) {
    return (
      <Select value={value} onValueChange={onChange} disabled={disabled}>
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
          disabled={disabled}
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
            : field.type === "url"
              ? "url"
            : field.type === "number"
              ? "number"
              : field.type === "date"
                ? "date"
                : "text"
      }
      value={value}
      onChange={(e) => onChange(e.target.value)}
      disabled={disabled}
      placeholder="Enter your answer…"
    />
  );
}
