import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useSendAttempt } from "@/hooks/use-send-attempt";
import { getProgramWorkflow } from "@/lib/api";
import {
  acfGenerateAwardAgreement,
  acfPreviewAwardAgreement,
  acfSendContract,
  ApiError,
  type AgreementPreview,
} from "@/lib/apiClient";
import { describeDelivery } from "@/lib/client-send";
import type { Award, Client, ProgramWorkflowContractTemplate } from "@/types";

/**
 * Prepares and sends a funding award's agreement: staff review the exact text (award amount,
 * business name and dates filled in), then the agreement is created from that text and emailed.
 * Signing it records the award's signature only; it never changes the client's onboarding.
 */
export function AwardAgreementDialog({
  award,
  client,
  open,
  onOpenChange,
  onSent,
}: {
  award: Award;
  client: Client;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: () => void;
}) {
  const attempt = useSendAttempt();
  const [templates, setTemplates] = useState<ProgramWorkflowContractTemplate[]>([]);
  const [templateId, setTemplateId] = useState<string | undefined>(
    award.agreementTemplateId ?? undefined,
  );
  const [review, setReview] = useState<(AgreementPreview & { awardId: string }) | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Programs can have several award agreements; staff choose when there is more than one.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getProgramWorkflow(award.programId)
      .then((workflow) => {
        if (cancelled) return;
        const awardTemplates = workflow.contract.templates.filter(
          (template) => template.purpose === "award",
        );
        setTemplates(awardTemplates);
        if (!templateId && awardTemplates.length === 1) setTemplateId(awardTemplates[0].id);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, award.programId]);

  async function loadReview() {
    setLoading(true);
    setError(null);
    try {
      setReview(await acfPreviewAwardAgreement(award.id, templateId ? { templateId } : {}));
    } catch (failure) {
      setReview(null);
      setError(failure instanceof Error ? failure.message : "Unable to prepare the agreement.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) {
      setReview(null);
      setError(null);
      return;
    }
    if (templates.length > 1 && !templateId && !review?.existingContractId) return;
    void loadReview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templateId, templates.length]);

  async function send() {
    if (!review) return;
    try {
      const result = await attempt.run(async (idempotencyKey) => {
        const contractId =
          review.existingContractId ??
          (
            await acfGenerateAwardAgreement(award.id, {
              ...(templateId ? { templateId } : {}),
              reviewedVersionId: review.versionId,
              reviewedContentHash: review.contentHash,
            })
          ).contract.id;
        return acfSendContract(client.id, contractId, {
          enrollmentId: award.enrollmentId,
          idempotencyKey,
        });
      });
      if (!result) return;
      const outcome = describeDelivery(result.emailDelivery);
      if (outcome.ok) toast.success(`Award agreement sent to ${client.email}.`);
      else toast.error(outcome.message);
      onSent();
      onOpenChange(false);
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Unable to send the agreement.");
      if (failure instanceof ApiError && failure.status === 409) void loadReview();
    }
  }

  const resend = !!review?.existingContractId;
  const blocked = !review || review.missing.length > 0 || attempt.sending;

  return (
    <Dialog open={open} onOpenChange={(value) => !attempt.sending && onOpenChange(value)}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Award agreement</DialogTitle>
          <DialogDescription>
            {award.title} · {client.email}
          </DialogDescription>
        </DialogHeader>

        {templates.length > 1 && !resend && (
          <div className="space-y-1">
            <Label>Agreement</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger aria-label="Award agreement template">
                <SelectValue placeholder="Choose the award agreement" />
              </SelectTrigger>
              <SelectContent>
                {templates.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : loading && !review ? (
          <p className="text-sm text-muted-foreground">Preparing the agreement…</p>
        ) : review ? (
          <div className="space-y-3 text-sm">
            <p className="font-medium">{review.title}</p>
            <pre
              aria-label="Agreement text"
              className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-3 font-sans text-sm"
            >
              {review.content}
            </pre>
            {review.missing.length > 0 ? (
              <div role="alert" className="space-y-1 text-destructive">
                <p className="font-medium">Fill in these details before sending:</p>
                <ul className="list-disc pl-5">
                  {review.missing.map((field) => (
                    <li key={field.key}>{field.label}</li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-muted-foreground">
                {resend
                  ? "Resending emails a new signing link; the previous link stops working."
                  : "This is the text the client will sign. Sending emails them the signing link."}
              </p>
            )}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" disabled={attempt.sending} onClick={() => onOpenChange(false)}>
            Close
          </Button>
          <Button disabled={blocked} onClick={() => void send()}>
            {attempt.sending ? "Sending…" : resend ? "Resend signing link" : "Send agreement"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
