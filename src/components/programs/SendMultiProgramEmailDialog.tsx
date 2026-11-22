import { Eye } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { useSendAttempt } from "@/hooks/use-send-attempt";
import {
  ApiError,
  cfPreviewMultiProgramEmailRecipients,
  cfPreviewProgramEmail,
  cfSendMultiProgramEmail,
  cfSendProgramEmailTest,
  type ProgramEmailPreview,
} from "@/lib/apiClient";
import { describeDelivery } from "@/lib/client-send";
import type { MultiProgramEmailResult, MultiProgramRecipientsPreview } from "@/lib/program-emails";
import { EmailPreview, MessageEditor, type Candidate } from "./SendProgramEmailDialog";

const SUBJECT_MAX = 200;

const plural = (count: number) => `${count} ${count === 1 ? "member" : "members"}`;
const people = (count: number) => `${count} ${count === 1 ? "person" : "people"}`;

/**
 * One message to the members of the programs chosen (one, several or all). Each person gets one
 * copy even if they are in several programs; the server records it under each program, so every
 * program's Emails tab shows its part. Test and archived clients are never emailed.
 */
export function SendMultiProgramEmailDialog({
  programs,
  open,
  onOpenChange,
  onSent,
}: {
  /** Every program, in the order shown (and the order members are assigned to programs). */
  programs: { id: string; name: string; isActive: boolean }[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSent?: (result: MultiProgramEmailResult) => void;
}) {
  const [step, setStep] = useState<"compose" | "preview">("compose");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [recipients, setRecipients] = useState<MultiProgramRecipientsPreview | null>(null);
  const [loadingRecipients, setLoadingRecipients] = useState(false);
  const [recipientsFailed, setRecipientsFailed] = useState(false);
  const [rendered, setRendered] = useState<ProgramEmailPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [sendingTest, setSendingTest] = useState(false);
  const attempt = useSendAttempt();
  const resetAttempt = attempt.reset;

  useEffect(() => {
    if (!open) return;
    setStep("compose");
    setSelected(new Set());
    setRecipients(null);
    resetAttempt();
  }, [open, resetAttempt]);

  // Chosen programs in display order, so the server shares members out the same way every time.
  const programIds = useMemo(
    () => programs.filter((program) => selected.has(program.id)).map((program) => program.id),
    [programs, selected],
  );
  const programKey = programIds.join(",");

  useEffect(() => {
    if (!open || !programKey) {
      setRecipients(null);
      return;
    }
    let cancelled = false;
    setLoadingRecipients(true);
    setRecipientsFailed(false);
    cfPreviewMultiProgramEmailRecipients(programKey.split(","))
      .then((result) => {
        if (!cancelled) setRecipients(result);
      })
      .catch(() => {
        if (!cancelled) {
          setRecipients(null);
          setRecipientsFailed(true);
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingRecipients(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, programKey]);

  const everyProgram = programs.length > 0 && programs.every((program) => selected.has(program.id));
  const recipientCount = recipients?.recipientCount ?? 0;
  const firstProgramId = programIds[0];
  const ready =
    programIds.length > 0 &&
    !loadingRecipients &&
    recipientCount > 0 &&
    subject.trim().length > 0 &&
    body.trim().length > 0;

  const toggle = (programId: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(programId);
    else next.delete(programId);
    setSelected(next);
  };

  async function showPreview() {
    if (!firstProgramId) return;
    setLoadingPreview(true);
    try {
      // Rendered with the first chosen program's email style; members of other programs get
      // their own program's style.
      setRendered(
        await cfPreviewProgramEmail(firstProgramId, { subject: subject.trim(), body: body.trim() }),
      );
      setStep("preview");
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "The preview couldn't be loaded. Try again.",
      );
    } finally {
      setLoadingPreview(false);
    }
  }

  async function sendTest() {
    if (!firstProgramId) return;
    setSendingTest(true);
    try {
      const result = await cfSendProgramEmailTest(firstProgramId, {
        subject: subject.trim(),
        body: body.trim(),
      });
      const outcome = describeDelivery(result.delivery);
      if (outcome.ok)
        toast.success(`Test sent to ${result.recipientEmail}. Members were not emailed.`);
      else toast.error(outcome.message);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "The test couldn't be sent. Try again.",
      );
    } finally {
      setSendingTest(false);
    }
  }

  async function send() {
    try {
      const result = await attempt.run((idempotencyKey) =>
        cfSendMultiProgramEmail(
          { programIds, subject: subject.trim(), body: body.trim() },
          idempotencyKey,
        ),
      );
      if (!result) return; // a send is already running
      const programsSent = result.emails.length;
      toast.success(
        `Sending to ${people(result.recipientCount)} across ${programsSent} ${programsSent === 1 ? "program" : "programs"}. Progress shows in each program's Emails tab.`,
      );
      setSubject("");
      setBody("");
      onSent?.(result);
      onOpenChange(false);
    } catch (error) {
      toast.error(
        error instanceof ApiError ? error.message : "The email couldn't be sent. Try again.",
      );
    }
  }

  const sendLabel = attempt.sending ? "Sending…" : `Send to ${people(recipientCount)}`;
  const previewRecipients: Candidate[] = (recipients?.recipients ?? []).map((recipient) => ({
    clientId: recipient.clientId,
    businessName: recipient.businessName,
    name: recipient.name,
    email: recipient.email,
  }));

  return (
    <Dialog open={open} onOpenChange={(value) => !attempt.sending && onOpenChange(value)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Email members</DialogTitle>
          <DialogDescription>
            Choose one or more programs. Each person gets one copy, even if they are in several of
            them. Test and archived clients are never emailed.
          </DialogDescription>
        </DialogHeader>

        {step === "compose" ? (
          <div className="space-y-4">
            <div className="space-y-2 rounded-md border border-border p-3">
              <label className="flex items-center gap-2 text-sm font-medium">
                <Checkbox
                  aria-label="All programs"
                  checked={everyProgram ? true : selected.size > 0 ? "indeterminate" : false}
                  onCheckedChange={(value) =>
                    setSelected(
                      new Set(value === true ? programs.map((program) => program.id) : []),
                    )
                  }
                />
                All programs
              </label>
              <ul aria-label="Programs" className="grid gap-1 sm:grid-cols-2">
                {programs.map((program) => {
                  const share = recipients?.programs.find((row) => row.id === program.id);
                  return (
                    <li key={program.id}>
                      <label className="flex cursor-pointer items-start gap-2 rounded px-1 py-1 text-sm hover:bg-muted/40">
                        <Checkbox
                          aria-label={program.name}
                          checked={selected.has(program.id)}
                          onCheckedChange={(value) => toggle(program.id, value === true)}
                        />
                        <span className="min-w-0">
                          {program.name}
                          {!program.isActive && (
                            <span className="text-muted-foreground"> (inactive)</span>
                          )}
                          {share && (
                            <span className="block text-xs text-muted-foreground">
                              {plural(share.recipientCount)}
                              {share.alreadyIncluded > 0
                                ? ` · ${share.alreadyIncluded} already included from another program`
                                : ""}
                            </span>
                          )}
                        </span>
                      </label>
                    </li>
                  );
                })}
              </ul>
              <p className="text-sm" aria-live="polite">
                {programIds.length === 0 ? (
                  <span className="text-muted-foreground">Choose at least one program.</span>
                ) : loadingRecipients ? (
                  <span className="text-muted-foreground">Counting members…</span>
                ) : recipientsFailed ? (
                  <span className="text-destructive">The member list couldn&apos;t be loaded.</span>
                ) : recipients && recipientCount === 0 ? (
                  <span role="alert" className="text-destructive">
                    Nobody in the chosen programs has a usable email address.
                  </span>
                ) : recipients ? (
                  <span>
                    To: <span aria-label="Recipient summary">{people(recipientCount)}</span>
                    {recipients.skippedCount > 0 && (
                      <span className="text-muted-foreground">
                        {" "}
                        · {recipients.skippedCount} can&apos;t be emailed
                      </span>
                    )}
                  </span>
                ) : null}
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="program-email-subject">Subject</Label>
              <Input
                id="program-email-subject"
                value={subject}
                maxLength={SUBJECT_MAX}
                onChange={(event) => setSubject(event.target.value)}
              />
            </div>
            <MessageEditor value={body} onChange={setBody} />
          </div>
        ) : (
          rendered && (
            <EmailPreview
              email={rendered}
              everyone
              recipients={previewRecipients}
              sharing={[]}
              unreachable={(recipients?.skipped ?? []).filter(
                (member) => member.reason !== "duplicate_email",
              )}
            />
          )
        )}

        <DialogFooter>
          {step === "compose" ? (
            <>
              <Button
                variant="ghost"
                disabled={attempt.sending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                variant="outline"
                disabled={!ready || loadingPreview || attempt.sending}
                onClick={() => void showPreview()}
              >
                <Eye className="mr-1.5 h-4 w-4" />
                {loadingPreview ? "Loading preview…" : "Preview email"}
              </Button>
              <Button disabled={!ready || attempt.sending} onClick={() => void send()}>
                {sendLabel}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                disabled={attempt.sending}
                onClick={() => setStep("compose")}
              >
                Back to editing
              </Button>
              <Button
                variant="outline"
                disabled={sendingTest || attempt.sending}
                onClick={() => void sendTest()}
              >
                {sendingTest ? "Sending test…" : "Send test to me"}
              </Button>
              <Button disabled={!ready || attempt.sending} onClick={() => void send()}>
                {sendLabel}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
