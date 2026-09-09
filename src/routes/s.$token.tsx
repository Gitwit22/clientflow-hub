import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { isSocialMediaField, SocialMediaInput } from "@/components/SocialMediaInput";
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
  isStalePublicFormError,
  submitPublicForm,
  ApiError,
  type PublicFormData,
  type PublicFormField,
  type PublicFormResponseValue,
  type PublicFormSection,
} from "@/lib/apiClient";
import {
  clearPublicFormIdempotencyKey,
  getPublicFormIdempotencyKey,
} from "@/lib/public-form-session";

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
  | "unavailable"
  | "already_submitted"
  | "stale";

function PublicFormPage() {
  const { token } = Route.useParams();
  const [status, setStatus] = useState<PageStatus>("loading");
  const [formData, setFormData] = useState<PublicFormData | null>(null);
  const [coreResponses, setCoreResponses] = useState<Record<string, PublicFormResponseValue>>({});
  const [programResponses, setProgramResponses] = useState<
    Record<string, Record<string, PublicFormResponseValue>>
  >({});
  const [selectedProgramIds, setSelectedProgramIds] = useState<string[]>([]);
  const [errorMsg, setErrorMsg] = useState("");
  const [startedAt] = useState(() => new Date().toISOString());
  const [idempotencyKey] = useState(() => getPublicFormIdempotencyKey(token));

  useEffect(() => {
    getPublicForm(token)
      .then((data) => {
        setFormData(data);
        const initialCore: Record<string, PublicFormResponseValue> = {};
        const initialPrograms: Record<string, Record<string, PublicFormResponseValue>> = {};
        for (const section of data.intakeConfiguration.sections) {
          const target =
            section.kind === "core" ? initialCore : (initialPrograms[section.programId!] ??= {});
          for (const field of section.fields) {
            target[field.id] = section.kind === "core" ? (data.prefill[field.id] ?? "") : "";
          }
        }
        setCoreResponses(initialCore);
        setProgramResponses(initialPrograms);
        if (["submitted", "approved"].includes(data.assignment.status)) {
          setStatus("already_submitted");
        } else {
          setStatus("ready");
        }
      })
      .catch((err: { status?: number } | null) => {
        if (err && err.status === 404) {
          setStatus("not_found");
        } else if (err && err.status === 410) {
          setStatus("unavailable");
        } else {
          setErrorMsg("Unable to load the form. Please try again or contact us directly.");
          setStatus("error");
        }
      });
  }, [token]);

  const set = (section: PublicFormSection, id: string, value: PublicFormResponseValue) => {
    if (section.kind === "core") {
      setCoreResponses((current) => ({ ...current, [id]: value }));
      return;
    }
    setProgramResponses((current) => ({
      ...current,
      [section.programId!]: { ...current[section.programId!], [id]: value },
    }));
  };

  const responsesFor = (section: PublicFormSection) =>
    section.kind === "core" ? coreResponses : (programResponses[section.programId!] ?? {});

  const toggleProgram = (programId: string, checked: boolean) => {
    setSelectedProgramIds((current) =>
      checked ? [...current, programId] : current.filter((id) => id !== programId),
    );
  };

  async function handleSubmit() {
    if (!formData) return;
    const visibleSections = getVisibleSections(formData, selectedProgramIds);
    const missing = visibleSections.flatMap((section) =>
      section.fields
        .filter((field) => !isRequiredResponseComplete(field, responsesFor(section)[field.id]))
        .map(publicFieldLabel),
    );

    if (missing.length > 0) {
      toast.error(
        `Please complete: ${missing.slice(0, 3).join(", ")}${missing.length > 3 ? ` (+${missing.length - 3} more)` : ""}`,
      );
      return;
    }

    setStatus("submitting");
    try {
      await submitPublicForm(token, {
        coreResponses,
        programResponses: Object.fromEntries(
          selectedProgramIds.map((programId) => [programId, programResponses[programId] ?? {}]),
        ),
        selectedProgramIds,
        configurationToken: formData.intakeConfiguration.configurationToken,
        idempotencyKey,
        startedAt,
      });
      clearPublicFormIdempotencyKey(token, idempotencyKey);
      setStatus("success");
    } catch (error) {
      if (isStalePublicFormError(error)) {
        setErrorMsg(error.message);
        setStatus("stale");
        return;
      }
      setStatus("ready");
      toast.error(
        error instanceof ApiError
          ? `${error.message}${error.code !== "UNKNOWN" ? ` (Reference: ${error.code})` : ""}`
          : "Submission failed. Please try again.",
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

  if (status === "unavailable") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="font-display text-xl font-semibold">Form link unavailable</h1>
          <p className="text-sm text-muted-foreground">
            This form link is no longer active. Please contact us for a new link.
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

  if (status === "stale") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="font-display text-xl font-semibold">Form updated</h1>
          <p className="text-sm text-muted-foreground">{errorMsg}</p>
          <Button onClick={() => globalThis.location.reload()}>Reload latest form</Button>
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
    .filter(isPublicFieldRequired);
  const completed = visibleSections.reduce(
    (count, section) =>
      count +
      section.fields.filter((field) =>
        isRequiredResponseComplete(field, responsesFor(section)[field.id]),
      ).length,
    0,
  );
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
          <legend className="px-1 text-sm font-semibold">Additional programs (optional)</legend>
          {formData.intakeConfiguration.programs.length > 0 ? (
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
          ) : (
            <p className="text-sm text-muted-foreground">
              There are no additional programs available for this profile.
            </p>
          )}
        </fieldset>

        {/* Core and selected-program fields */}
        <div className="space-y-8">
          {visibleSections.map((section) => (
            <section
              key={section.id}
              className="space-y-5"
              aria-labelledby={`section-${section.id}`}
            >
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
                  {field.type !== "checkbox" && (
                    <Label htmlFor={`field-${section.id}-${field.id}`}>
                      {publicFieldLabel(field)}
                      {isPublicFieldRequired(field) && (
                        <span className="ml-1 text-destructive">*</span>
                      )}
                    </Label>
                  )}
                  <PublicFieldInput
                    field={field}
                    inputId={`field-${section.id}-${field.id}`}
                    value={
                      typeof responsesFor(section)[field.id] === "string"
                        ? String(responsesFor(section)[field.id])
                        : ""
                    }
                    onChange={(value) => set(section, field.id, value)}
                    disabled={status === "submitting"}
                  />
                  {field.helpText && (
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      {field.id === "agreement" &&
                      field.helpText.startsWith("By selecting I Accept") ? (
                        <>
                          By selecting{" "}
                          <strong className="font-semibold text-foreground">I Accept</strong>
                          {field.helpText.slice("By selecting I Accept".length)}
                        </>
                      ) : (
                        field.helpText
                      )}
                    </p>
                  )}
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
    (section) =>
      section.kind === "core" || (section.programId !== null && selected.has(section.programId)),
  );
}

function isBlank(value: PublicFormResponseValue | undefined): boolean {
  return (
    value === undefined ||
    value === null ||
    (typeof value === "string" && value.trim().length === 0) ||
    (Array.isArray(value) && value.length === 0)
  );
}

function isPublicFieldRequired(field: PublicFormField): boolean {
  return field.required && field.type !== "file";
}

function isRequiredResponseComplete(
  field: PublicFormField,
  value: PublicFormResponseValue | undefined,
): boolean {
  if (!isPublicFieldRequired(field)) return true;
  if (field.type === "checkbox") return value === true || value === "true";
  return !isBlank(value);
}

const legacyFieldLabels: Record<string, string> = {
  name: "Name",
  primaryContactName: "Name",
  business: "Business / Organization Name",
  businessName: "Business / Organization Name",
  email: "Email",
  phone: "Phone",
  website: "Website",
  facebookUrl: "Facebook URL",
  instagramUrl: "Instagram URL",
  linkedinUrl: "LinkedIn URL",
  tiktokUrl: "TikTok URL",
  youtubeUrl: "YouTube URL",
  businessType: "Business type",
  program: "Program or service of interest",
  programOfInterest: "Program or service of interest",
  description: "Brief business description",
  businessDescription: "Brief business description",
  assistance: "Type of assistance needed",
  assistanceRequested: "Type of assistance needed",
  budget: "Estimated budget",
  budgetNeed: "Estimated budget",
  start: "Desired start date",
  contact: "Preferred contact method",
  preferredContact: "Preferred contact method",
  heard: "How did you hear about us?",
  heardAboutUs: "How did you hear about us?",
  comments: "Additional comments",
  additionalComments: "Additional comments",
};

function publicFieldLabel(field: PublicFormField): string {
  const label = field.label.trim();
  if (label) return label;
  return (
    legacyFieldLabels[field.id] ??
    (field.id
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .replace(/[-_]+/g, " ")
      .trim() ||
      "Form field")
  );
}

function PublicFieldInput({
  field,
  inputId,
  value,
  onChange,
  disabled,
}: {
  field: PublicFormField;
  inputId: string;
  value: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}) {
  if (isSocialMediaField(field.id)) {
    return (
      <SocialMediaInput
        fieldId={field.id}
        inputId={inputId}
        value={value}
        onChange={onChange}
        disabled={disabled}
      />
    );
  }
  if (field.type === "textarea") {
    return (
      <Textarea
        id={inputId}
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
        <SelectTrigger id={inputId}>
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
          id={inputId}
          checked={value === "true"}
          onCheckedChange={(checked) => onChange(String(Boolean(checked)))}
          disabled={disabled}
        />
        <label htmlFor={inputId} className="cursor-pointer text-sm">
          {publicFieldLabel(field)}
          {isPublicFieldRequired(field) && <span className="ml-1 text-destructive">*</span>}
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
  if (field.type === "signature") {
    return (
      <div className="space-y-3">
        <Input
          id={inputId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          disabled={disabled}
          maxLength={200}
          autoComplete="name"
          placeholder="Type your full legal name"
        />
        <div className="flex min-h-20 items-center border-b border-foreground/50 px-3 py-2">
          <span className="font-signature text-3xl text-foreground">
            {value || "Your signature"}
          </span>
        </div>
      </div>
    );
  }
  return (
    <Input
      id={inputId}
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
