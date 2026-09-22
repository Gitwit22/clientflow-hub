import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import {
  isPublicFieldRequired,
  isRequiredResponseComplete,
  PublicFieldInput,
  publicFieldLabel,
} from "@/components/PublicFieldInput";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import {
  acfGetPublicIntakeForm,
  acfSubmitPublicIntakeForm,
  ApiError,
  type AutomatedPublicIntakeData,
  type PublicFormResponseValue,
} from "@/lib/apiClient";

export const Route = createFileRoute("/apply/$token")({
  head: () => ({
    meta: [{ title: "Complete your intake — ClientFlow" }],
  }),
  component: PublicIntakePage,
});

type PageStatus =
  | "loading"
  | "ready"
  | "submitting"
  | "success"
  | "not_found"
  | "error"
  | "already_submitted";

function PublicIntakePage() {
  const { token } = Route.useParams();
  const [status, setStatus] = useState<PageStatus>("loading");
  const [formData, setFormData] = useState<AutomatedPublicIntakeData | null>(null);
  const [answers, setAnswers] = useState<Record<string, PublicFormResponseValue>>({});
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    acfGetPublicIntakeForm(token)
      .then((data) => {
        setFormData(data);
        const initial: Record<string, PublicFormResponseValue> = {};
        for (const field of data.form.fields) {
          if (field.id === "contactName") initial[field.id] = data.client.contactName ?? "";
          else if (field.id === "businessName") initial[field.id] = data.client.businessName ?? "";
          else if (field.id === "email") initial[field.id] = data.client.email ?? "";
          else if (field.id === "phone") initial[field.id] = data.client.phone ?? "";
          else initial[field.id] = field.type === "social_links" ? [] : "";
        }
        setAnswers(initial);
        setStatus(data.assignment.status === "submitted" ? "already_submitted" : "ready");
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          setStatus("not_found");
        } else {
          setErrorMsg("Unable to load the form. Please try again or contact us directly.");
          setStatus("error");
        }
      });
  }, [token]);

  function setAnswer(fieldId: string, value: PublicFormResponseValue) {
    setAnswers((current) => ({ ...current, [fieldId]: value }));
  }

  async function handleSubmit() {
    if (!formData) return;
    const missing = formData.form.fields
      .filter((field) => !isRequiredResponseComplete(field, answers[field.id]))
      .map(publicFieldLabel);
    if (missing.length > 0) {
      toast.error(`Please complete: ${missing.join(", ")}`);
      return;
    }

    setStatus("submitting");
    try {
      await acfSubmitPublicIntakeForm(token, answers);
      setStatus("success");
    } catch (error) {
      setStatus("ready");
      toast.error(
        error instanceof ApiError ? error.message : "Submission failed. Please try again.",
      );
    }
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading your form…</p>
      </div>
    );
  }

  if (status === "not_found") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="font-display text-xl font-semibold">Link not found</h1>
          <p className="text-sm text-muted-foreground">
            This form link is invalid or has expired. Please contact us if you need a new link.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="font-display text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (status === "already_submitted") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="font-display text-xl font-semibold">Already submitted</h1>
          <p className="text-sm text-muted-foreground">
            This form has already been submitted. Thank you!
          </p>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="font-display text-2xl font-semibold">Intake received!</h1>
          <p className="text-muted-foreground">
            Thank you. A team member will follow up soon with next steps.
          </p>
        </div>
      </div>
    );
  }

  if (!formData) return null;

  const requiredFields = formData.form.fields.filter(isPublicFieldRequired);
  const completed = formData.form.fields.filter((field) =>
    isRequiredResponseComplete(field, answers[field.id]),
  ).length;
  const progressPct =
    requiredFields.length > 0 ? Math.round((completed / requiredFields.length) * 100) : 100;

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold">{formData.form.name}</h1>
          {formData.form.description && (
            <p className="text-sm text-muted-foreground">{formData.form.description}</p>
          )}
        </div>

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

        <div className="space-y-5">
          {formData.form.fields.map((field) => (
            <div key={field.id} className="space-y-1.5">
              {field.type !== "checkbox" && (
                <Label htmlFor={`field-${field.id}`}>
                  {publicFieldLabel(field)}
                  {isPublicFieldRequired(field) && <span className="ml-1 text-destructive">*</span>}
                </Label>
              )}
              <PublicFieldInput
                field={field}
                inputId={`field-${field.id}`}
                value={answers[field.id] ?? (field.type === "social_links" ? [] : "")}
                onChange={(value) => setAnswer(field.id, value)}
                disabled={status === "submitting"}
              />
            </div>
          ))}
        </div>

        <div className="flex justify-end border-t border-border pt-6">
          <Button onClick={handleSubmit} disabled={status === "submitting"} size="lg">
            {status === "submitting" ? "Submitting…" : "Submit"}
          </Button>
        </div>
      </div>
    </div>
  );
}
