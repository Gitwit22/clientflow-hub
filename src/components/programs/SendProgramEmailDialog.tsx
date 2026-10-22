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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useSendAttempt } from "@/hooks/use-send-attempt";
import { ApiError, cfPreviewProgramEmailRecipients, cfSendProgramEmail } from "@/lib/apiClient";
import {
  SKIP_REASON_LABELS,
  type ProgramEmailDetail,
  type ProgramEmailRecipientsPreview,
} from "@/lib/program-emails";

const SUBJECT_MAX = 200;
const BODY_MAX = 20_000;

/**
 * Write a message, review who will get it (and who is skipped and why), then send. Each member
 * gets their own copy from the server; this dialog never waits for the whole list to go out.
 */
export function SendProgramEmailDialog({
  programId,
  programName,
  open,
  onOpenChange,
  onSent,
}: {
  programId: string;
  programName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent: (email: ProgramEmailDetail) => void;
}) {
  const [step, setStep] = useState<"compose" | "review">("compose");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [preview, setPreview] = useState<ProgramEmailRecipientsPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const attempt = useSendAttempt();
  const resetAttempt = attempt.reset;

  useEffect(() => {
    if (!open) return;
    setStep("compose");
    setPreview(null);
    resetAttempt();
  }, [open, resetAttempt]);

  async function review() {
    setLoadingPreview(true);
    try {
      setPreview(await cfPreviewProgramEmailRecipients(programId));
      setStep("review");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't load the recipients.");
    } finally {
      setLoadingPreview(false);
    }
  }

  async function send() {
    try {
      const email = await attempt.run((idempotencyKey) =>
        cfSendProgramEmail(
          programId,
          { subject: subject.trim(), body: body.trim() },
          idempotencyKey,
        ),
      );
      if (!email) return; // a send is already running
      toast.success(
        `Sending to ${email.recipientCount} ${email.recipientCount === 1 ? "member" : "members"}. Progress shows in the email history.`,
      );
      setSubject("");
      setBody("");
      onSent(email);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "The email couldn't be sent. Try again.",
      );
    }
  }

  const canReview = subject.trim().length > 0 && body.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(value) => !attempt.sending && onOpenChange(value)}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display">Send program email</DialogTitle>
          <DialogDescription>
            To everyone enrolled in {programName}. Each member gets their own copy, with the same
            header and sign-off as other ClientFlow emails.
          </DialogDescription>
        </DialogHeader>

        {step === "compose" ? (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="program-email-subject">Subject</Label>
              <Input
                id="program-email-subject"
                value={subject}
                maxLength={SUBJECT_MAX}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="program-email-body">Message</Label>
              <Textarea
                id="program-email-body"
                rows={9}
                value={body}
                maxLength={BODY_MAX}
                onChange={(event) => setBody(event.target.value)}
                placeholder={"Hello everyone,\n\n…"}
              />
              <p className="text-xs text-muted-foreground">
                Sent as written. A blank line starts a new paragraph.
              </p>
            </div>
          </div>
        ) : (
          preview && <RecipientReview preview={preview} subject={subject.trim()} />
        )}

        <DialogFooter>
          {step === "compose" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={!canReview || loadingPreview} onClick={() => void review()}>
                {loadingPreview ? "Loading…" : "Review recipients"}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={attempt.sending}
                onClick={() => setStep("compose")}
              >
                Back
              </Button>
              <Button
                disabled={attempt.sending || !preview || preview.recipientCount === 0}
                onClick={() => void send()}
              >
                {attempt.sending
                  ? "Sending…"
                  : `Send to ${preview?.recipientCount ?? 0} ${preview?.recipientCount === 1 ? "member" : "members"}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecipientReview({
  preview,
  subject,
}: {
  preview: ProgramEmailRecipientsPreview;
  subject: string;
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <span className="font-medium">“{subject}”</span> will go to{" "}
        <span className="font-medium" aria-label="Recipient count">
          {preview.recipientCount} {preview.recipientCount === 1 ? "member" : "members"}
        </span>
        {preview.skippedCount > 0 && (
          <>
            ; <span className="font-medium">{preview.skippedCount}</span> will be skipped
          </>
        )}
        .
      </p>
      {preview.recipientCount === 0 && (
        <p role="alert" className="text-sm text-destructive">
          Nobody in this program has a usable email address.
        </p>
      )}
      <ul
        aria-label="Recipients"
        className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm"
      >
        {preview.recipients.map((recipient) => (
          <li
            key={recipient.clientId}
            className="flex flex-wrap justify-between gap-x-3 px-3 py-1.5"
          >
            <span>
              {recipient.businessName}
              <span className="text-muted-foreground"> · {recipient.name}</span>
            </span>
            <span className="text-muted-foreground">{recipient.email}</span>
          </li>
        ))}
      </ul>
      {preview.skippedCount > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Skipped</p>
          <ul
            aria-label="Skipped members"
            className="mt-1 space-y-0.5 text-xs text-muted-foreground"
          >
            {preview.skipped.map((member) => (
              <li key={member.clientId}>
                {member.businessName}
                {member.email ? ` (${member.email})` : ""} — {SKIP_REASON_LABELS[member.reason]}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
