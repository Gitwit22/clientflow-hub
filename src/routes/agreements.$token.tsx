import { useEffect, useState, type FormEvent } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  acfAcceptPublicContract,
  acfGetPublicContract,
  ApiError,
  type AutomatedPublicContractData,
} from "@/lib/apiClient";

export const Route = createFileRoute("/agreements/$token")({
  head: () => ({
    meta: [{ title: "Review your agreement — ClientFlow" }],
  }),
  component: PublicContractPage,
});

type PageStatus = "loading" | "ready" | "submitting" | "success" | "not_found" | "error";

function PublicContractPage() {
  const { token } = Route.useParams();
  const [status, setStatus] = useState<PageStatus>("loading");
  const [data, setData] = useState<AutomatedPublicContractData | null>(null);
  const [signedName, setSignedName] = useState("");
  const [signedEmail, setSignedEmail] = useState("");
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [signatureNote, setSignatureNote] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  useEffect(() => {
    acfGetPublicContract(token)
      .then((result) => {
        setData(result);
        setStatus("ready");
      })
      .catch((error: unknown) => {
        if (error instanceof ApiError && error.status === 404) {
          setStatus("not_found");
        } else {
          setErrorMsg("Unable to load the agreement. Please try again or contact us directly.");
          setStatus("error");
        }
      });
  }, [token]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!signedName.trim() || !signedEmail.trim() || !agreedToTerms) {
      setErrorMsg("Please enter your name, email, and agree to the terms.");
      return;
    }

    setStatus("submitting");
    try {
      await acfAcceptPublicContract(token, {
        signedName: signedName.trim(),
        signedEmail: signedEmail.trim(),
        agreedToTerms: true,
        signatureNote: signatureNote.trim() || undefined,
      });
      setStatus("success");
    } catch (error) {
      setStatus("ready");
      setErrorMsg(
        error instanceof ApiError ? error.message : "Submission failed. Please try again.",
      );
    }
  }

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <p className="text-sm text-muted-foreground">Loading your agreement…</p>
      </div>
    );
  }

  if (status === "not_found") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="font-display text-xl font-semibold">Link not found</h1>
          <p className="text-sm text-muted-foreground">
            This agreement link is invalid, expired, or already completed. Please contact us if
            you need a new link.
          </p>
        </div>
      </div>
    );
  }

  if (status === "error" && !data) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-2 text-center">
          <h1 className="font-display text-xl font-semibold">Something went wrong</h1>
          <p className="text-sm text-muted-foreground">{errorMsg}</p>
        </div>
      </div>
    );
  }

  if (status === "success") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-6">
        <div className="max-w-md space-y-4 text-center">
          <h1 className="font-display text-2xl font-semibold">Agreement signed!</h1>
          <p className="text-muted-foreground">
            Thank you. Your onboarding has started and a welcome email is on its way.
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="min-h-screen bg-background px-4 py-12">
      <div className="mx-auto max-w-2xl space-y-8">
        <div className="space-y-1">
          <p className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
            {data.program.name}
          </p>
          <h1 className="font-display text-2xl font-semibold">{data.contract.contractName}</h1>
        </div>

        <div className="max-h-96 overflow-y-auto whitespace-pre-wrap rounded-md border border-border p-4 text-sm text-muted-foreground">
          {data.contract.content}
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="signed-name">Full name *</Label>
            <Input
              id="signed-name"
              value={signedName}
              onChange={(event) => setSignedName(event.target.value)}
              disabled={status === "submitting"}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signed-email">Email *</Label>
            <Input
              id="signed-email"
              type="email"
              value={signedEmail}
              onChange={(event) => setSignedEmail(event.target.value)}
              disabled={status === "submitting"}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="signature-note">Note (optional)</Label>
            <Textarea
              id="signature-note"
              value={signatureNote}
              onChange={(event) => setSignatureNote(event.target.value)}
              disabled={status === "submitting"}
              rows={3}
            />
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="agreed-to-terms"
              checked={agreedToTerms}
              onCheckedChange={(checked) => setAgreedToTerms(checked === true)}
              disabled={status === "submitting"}
            />
            <Label htmlFor="agreed-to-terms" className="text-sm font-normal leading-snug">
              I have read and agree to the terms of this agreement.
            </Label>
          </div>

          {errorMsg && <p className="text-sm text-destructive">{errorMsg}</p>}

          <Button type="submit" className="w-full" disabled={status === "submitting"}>
            {status === "submitting" ? "Submitting…" : "Sign agreement"}
          </Button>
        </form>
      </div>
    </div>
  );
}
