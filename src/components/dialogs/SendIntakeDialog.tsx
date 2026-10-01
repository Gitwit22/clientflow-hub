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
import { refreshClientCommunications } from "@/lib/api";
import { acfSendIntakeNow } from "@/lib/apiClient";
import { describeDelivery, recipientProblem } from "@/lib/client-send";
import type { Client } from "@/types";

/** Sends or resends the General Intake email. Only the intake form is ever resent from here. */
export function SendIntakeDialog({
  client,
  open,
  onOpenChange,
}: {
  client: Client;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const attempt = useSendAttempt();
  const problem = recipientProblem(client);

  async function handleSend() {
    try {
      const result = await attempt.run((idempotencyKey) =>
        acfSendIntakeNow(client.id, { idempotencyKey }),
      );
      if (!result) return;
      const outcome = describeDelivery(result.emailDelivery);
      void refreshClientCommunications(client.id).catch(() => undefined);
      if (outcome.ok) {
        toast.success(`Intake email sent to ${client.email}.`);
        onOpenChange(false);
      } else {
        toast.error(outcome.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send the intake email.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Send intake email</DialogTitle>
          <DialogDescription>
            Emails a fresh secure link to the General Intake form. Any earlier intake link stops
            working. If they already submitted one, they get a new copy filled in with what's on
            file, and their updated answers refresh the profile.
          </DialogDescription>
        </DialogHeader>
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted-foreground">Recipient</dt>
            <dd className="font-medium">{client.email}</dd>
          </div>
        </dl>
        {problem && <p className="text-sm text-destructive">{problem}</p>}
        <DialogFooter className="gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={attempt.sending}
          >
            Cancel
          </Button>
          <Button type="button" onClick={handleSend} disabled={attempt.sending || !!problem}>
            {attempt.sending ? "Sending…" : "Send intake email"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
