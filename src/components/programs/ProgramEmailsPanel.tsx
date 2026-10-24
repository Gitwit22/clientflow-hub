import { ChevronDown, Mail } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  FormattedEmailBody,
  SendProgramEmailDialog,
} from "@/components/programs/SendProgramEmailDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ApiError,
  cfGetProgramEmail,
  cfListProgramEmails,
  cfRetryProgramEmail,
} from "@/lib/apiClient";
import {
  OUTCOME_LABELS,
  SKIP_REASON_LABELS,
  failureReason,
  isStillSending,
  outcomeSummary,
  type ProgramEmailDetail,
  type ProgramEmailSummary,
} from "@/lib/program-emails";

const POLL_MS = 3000;

/** Programs › Emails: send one email to every member, and the program's send history. */
export function ProgramEmailsPanel({
  programId,
  programName,
}: {
  programId: string;
  programName: string;
}) {
  const [emails, setEmails] = useState<ProgramEmailSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEmails(await cfListProgramEmails(programId));
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, [programId]);

  useEffect(() => {
    void load();
  }, [load]);

  // While any email is still going out, refresh its progress.
  const sending = emails?.some(isStillSending) ?? false;
  useEffect(() => {
    if (!sending) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [sending, load]);

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 font-display text-base">
          <Mail className="h-4 w-4" /> Program emails
        </CardTitle>
        <Button size="sm" onClick={() => setComposing(true)}>
          Send email blast
        </Button>
      </CardHeader>
      <CardContent>
        {failed ? (
          <p className="text-sm text-muted-foreground">The email history couldn't be loaded.</p>
        ) : !emails ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : emails.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No program emails yet. Use “Send email blast” to write to every member, or the ones you
            choose.
          </p>
        ) : (
          <ul className="divide-y divide-border" aria-label="Program email history">
            {emails.map((email) => (
              <EmailRow
                key={email.id}
                email={email}
                open={openId === email.id}
                onToggle={() => setOpenId(openId === email.id ? null : email.id)}
                onChanged={() => void load()}
              />
            ))}
          </ul>
        )}
      </CardContent>
      <SendProgramEmailDialog
        programId={programId}
        programName={programName}
        open={composing}
        onOpenChange={setComposing}
        onSent={(email) => {
          setOpenId(email.id);
          void load();
        }}
      />
    </Card>
  );
}

function EmailRow({
  email,
  open,
  onToggle,
  onChanged,
}: {
  email: ProgramEmailSummary;
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
}) {
  const [detail, setDetail] = useState<ProgramEmailDetail | null>(null);
  const [retrying, setRetrying] = useState(false);
  const stillSending = isStillSending(email);

  // Reload the recipients when opened and whenever the counts move.
  const countsKey = JSON.stringify(email.counts);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    cfGetProgramEmail(email.id)
      .then((result) => !cancelled && setDetail(result))
      .catch(() => !cancelled && setDetail(null));
    return () => {
      cancelled = true;
    };
  }, [open, email.id, countsKey]);

  async function retry() {
    setRetrying(true);
    try {
      const result = await cfRetryProgramEmail(email.id);
      setDetail(result);
      toast.success(
        `Retrying ${email.counts.failed} failed ${email.counts.failed === 1 ? "recipient" : "recipients"}.`,
      );
      onChanged();
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't retry. Try again.");
    } finally {
      setRetrying(false);
    }
  }

  return (
    <li className="py-3" aria-label={email.subject}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <button type="button" className="min-w-0 text-left" onClick={onToggle} aria-expanded={open}>
          <p className="flex items-center gap-2 text-sm font-medium">
            <ChevronDown
              className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
            />
            {email.subject}
          </p>
          <p className="mt-0.5 pl-5 text-xs text-muted-foreground">
            {new Date(email.createdAt).toLocaleString()} · {email.sentByDisplayName} ·{" "}
            {email.recipientCount} {email.recipientCount === 1 ? "recipient" : "recipients"}
          </p>
          <p className="mt-0.5 pl-5 text-xs" aria-label="Outcome">
            {outcomeSummary(email)}
          </p>
        </button>
        <div className="flex items-center gap-2">
          {stillSending ? (
            <Badge variant="outline">Sending…</Badge>
          ) : email.counts.failed > 0 ? (
            <>
              <Badge variant="destructive">{email.counts.failed} failed</Badge>
              <Button size="sm" variant="outline" disabled={retrying} onClick={() => void retry()}>
                {retrying ? "Retrying…" : `Retry failed (${email.counts.failed})`}
              </Button>
            </>
          ) : (
            <Badge variant="secondary">Done</Badge>
          )}
        </div>
      </div>
      {open && (
        <div className="mt-3 space-y-3 pl-5">
          <div className="rounded-md bg-muted/40 p-3">
            <FormattedEmailBody body={email.body} />
          </div>
          <p className="text-xs text-muted-foreground">
            “Accepted” means the email provider took the message for delivery; it doesn't confirm it
            reached the inbox.
          </p>
          {!detail ? (
            <p className="text-xs text-muted-foreground">Loading recipients…</p>
          ) : (
            <>
              <ul aria-label="Recipient outcomes" className="divide-y divide-border text-sm">
                {detail.recipients.map((recipient) => (
                  <li
                    key={recipient.communicationId}
                    className="flex flex-wrap justify-between gap-x-3 py-1.5"
                  >
                    <span>
                      {recipient.businessName || recipient.name}
                      <span className="text-muted-foreground"> · {recipient.email}</span>
                    </span>
                    <span
                      className={
                        recipient.outcome === "failed"
                          ? "text-destructive"
                          : "text-muted-foreground"
                      }
                    >
                      {OUTCOME_LABELS[recipient.outcome]}
                      {recipient.outcome === "failed"
                        ? ` — ${failureReason(recipient.errorCode)}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
              {detail.skipped.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Not sent</p>
                  <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
                    {detail.skipped.map((member) => (
                      <li key={member.clientId}>
                        {member.businessName}
                        {member.email ? ` (${member.email})` : ""} —{" "}
                        {SKIP_REASON_LABELS[member.reason]}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </li>
  );
}
