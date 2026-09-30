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
import { useSendAttempt } from "@/hooks/use-send-attempt";
import { getProgramWorkflow, refreshClientCommunications } from "@/lib/api";
import { acfSendWelcome } from "@/lib/apiClient";
import {
  currentContract,
  describeDelivery,
  welcomeSendState,
  recipientProblem,
} from "@/lib/client-send";
import type { Client, Communication, Contract, Program, ProgramEnrollment } from "@/types";

const dateLabel = (value?: string | null) => (value ? new Date(value).toLocaleDateString() : "");

/**
 * Sends or resends the welcome email for an enrollment. The signature gate of the automatic workflow
 * applies: nothing can be sent until the enrollment's contract is signed.
 */
export function SendWelcomeDialog({
  client,
  enrollment,
  program,
  contracts,
  communications,
  open,
  onOpenChange,
}: {
  client: Client;
  enrollment: ProgramEnrollment;
  program: Program | undefined;
  contracts: readonly Contract[];
  communications: readonly Communication[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const attempt = useSendAttempt();
  const problem = recipientProblem(client);
  const state = welcomeSendState(currentContract(contracts, enrollment.id), communications);
  const [templateName, setTemplateName] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !program) return;
    let cancelled = false;
    getProgramWorkflow(program.id)
      .then((workflow) => {
        if (!cancelled) setTemplateName(workflow.welcomeEmail.activeTemplate?.name ?? null);
      })
      .catch(() => {
        if (!cancelled) setTemplateName(null);
      });
    return () => {
      cancelled = true;
    };
  }, [open, program?.id]);

  async function handleSend() {
    try {
      const result = await attempt.run((idempotencyKey) =>
        acfSendWelcome(client.id, enrollment.id, { idempotencyKey }),
      );
      if (!result) return;
      void refreshClientCommunications(client.id).catch(() => undefined);
      const outcome = describeDelivery(result.emailDelivery);
      if (outcome.ok) {
        toast.success(`Welcome email sent to ${client.email}.`);
        onOpenChange(false);
      } else {
        toast.error(outcome.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send the welcome email.");
    }
  }

  const status =
    state.kind === "sent"
      ? `Sent ${dateLabel(state.sentAt)}`
      : state.kind === "failed"
        ? `Last attempt failed${state.errorCode ? `: ${state.errorCode}` : ""}`
        : state.kind === "blocked"
          ? "Not sent (waiting for the signed contract)"
          : "Not sent";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Welcome email</DialogTitle>
          <DialogDescription>Sent after the contract is signed.</DialogDescription>
        </DialogHeader>

        <dl className="space-y-1.5 text-sm">
          {[
            ["Program", program?.name ?? "—"],
            ["Recipient", client.email],
            ["Template", templateName ?? "Program welcome message"],
            ["Status", status],
          ].map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>

        {state.kind === "blocked" && (
          <p role="alert" className="text-sm text-destructive">
            {state.reason}
          </p>
        )}

        {problem && <p className="text-sm text-destructive">{problem}</p>}
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={attempt.sending}
          >
            Close
          </Button>
          <Button
            type="button"
            onClick={handleSend}
            disabled={attempt.sending || state.kind === "blocked" || !!problem}
          >
            {attempt.sending
              ? "Sending…"
              : state.kind === "sent"
                ? "Resend welcome email"
                : "Send welcome email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
