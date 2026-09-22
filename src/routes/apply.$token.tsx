import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  acfGetPublicIntakeForm,
  acfSubmitPublicIntakeForm,
  ApiError,
  type AutomatedPublicIntakeData,
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
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    acfGetPublicIntakeForm(token)
      .then((data) => {
        setFormData(data);
        setAnswers({
          contactName: data.client.contactName ?? "",
          businessName: data.client.businessName ?? "",
          email: data.client.email ?? "",
          phone: data.client.phone ?? "",
        });
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

  function setAnswer(fieldId: string, value: string) {
    setAnswers((current) => ({ ...current, [fieldId]: value }));
  }

  async function handleSubmit() {
    if (!formData) return;
    const missing = formData.form.fields
      .filter((field) => field.required && !answers[field.id]?.trim())
      .map((field) => field.label);
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

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-xl space-y-8">
        <div className="space-y-1">
          <h1 className="font-display text-2xl font-semibold">{formData.form.name}</h1>
          {formData.form.description && (
            <p className="text-sm text-muted-foreground">{formData.form.description}</p>
          )}
        </div>

        <div className="space-y-5">
          {formData.form.fields.map((field) => (
            <div key={field.id} className="space-y-1.5">
              <Label htmlFor={`field-${field.id}`}>
                {field.label}
                {field.required && <span className="ml-1 text-destructive">*</span>}
              </Label>
              {field.type === "select" ? (
                <Select
                  value={answers[field.id] ?? ""}
                  onValueChange={(value) => setAnswer(field.id, value)}
                  disabled={status === "submitting"}
                >
                  <SelectTrigger id={`field-${field.id}`}>
                    <SelectValue placeholder="Select a program" />
                  </SelectTrigger>
                  <SelectContent>
                    {(field.options ?? []).map((option) => (
                      <SelectItem key={option} value={option}>
                        {option}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <Input
                  id={`field-${field.id}`}
                  type={field.type === "email" ? "email" : field.type === "phone" ? "tel" : "text"}
                  value={answers[field.id] ?? ""}
                  onChange={(event) => setAnswer(field.id, event.target.value)}
                  disabled={status === "submitting"}
                />
              )}
            </div>
          ))}
        </div>

        <Button className="w-full" onClick={handleSubmit} disabled={status === "submitting"}>
          {status === "submitting" ? "Submitting…" : "Submit"}
        </Button>
      </div>
    </div>
  );
}
