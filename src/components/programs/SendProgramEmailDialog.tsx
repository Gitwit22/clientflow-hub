import { Bold, Italic, Link2, List, ListOrdered } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { Textarea } from "@/components/ui/textarea";
import { useSendAttempt } from "@/hooks/use-send-attempt";
import { ApiError, cfPreviewProgramEmailRecipients, cfSendProgramEmail } from "@/lib/apiClient";
import {
  formattedEmailHtml,
  insertLink,
  toggleList,
  wrapSelection,
  type TextEdit,
} from "@/lib/email-format";
import {
  SKIP_REASON_LABELS,
  type ProgramEmailDetail,
  type ProgramEmailRecipientsPreview,
  type SkippedMember,
} from "@/lib/program-emails";

const SUBJECT_MAX = 200;
const BODY_MAX = 20_000;

/** A member who can be chosen: anyone with a usable address. */
interface Candidate {
  clientId: string;
  businessName: string;
  name: string;
  email: string;
}

/** A member who can't be emailed (no address, or one that isn't valid). */
type Unreachable = SkippedMember;

function candidatesOf(preview: ProgramEmailRecipientsPreview) {
  const candidates: Candidate[] = preview.recipients.map((recipient) => ({
    clientId: recipient.clientId,
    businessName: recipient.businessName,
    name: recipient.name,
    email: recipient.email,
  }));
  // Someone sharing an address is still choosable: chosen alone, they get the email.
  for (const member of preview.skipped) {
    if (member.reason === "duplicate_email" && member.email) {
      candidates.push({
        clientId: member.clientId,
        businessName: member.businessName,
        name: member.businessName,
        email: member.email,
      });
    }
  }
  candidates.sort(
    (a, b) => a.businessName.localeCompare(b.businessName) || a.clientId.localeCompare(b.clientId),
  );
  const unreachable: Unreachable[] = preview.skipped.filter(
    (member) => member.reason !== "duplicate_email",
  );
  return { candidates, unreachable };
}

/** Who gets a copy among the chosen members: one per address, in list order (as the server does). */
function deliveryList(chosen: Candidate[]) {
  const seen = new Set<string>();
  const recipients: Candidate[] = [];
  const sharing: Candidate[] = [];
  for (const candidate of chosen) {
    const email = candidate.email.toLowerCase();
    if (seen.has(email)) sharing.push(candidate);
    else {
      seen.add(email);
      recipients.push(candidate);
    }
  }
  return { recipients, sharing };
}

const plural = (count: number) => `${count} ${count === 1 ? "member" : "members"}`;

/**
 * Write a message (with light formatting), choose who gets it (everyone by default), review, then
 * send. Each member gets their own copy from the server; this dialog never waits for the list to go out.
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
  const [previewFailed, setPreviewFailed] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const attempt = useSendAttempt();
  const resetAttempt = attempt.reset;

  const loadRecipients = useCallback(async () => {
    setPreview(null);
    setPreviewFailed(false);
    try {
      const loaded = await cfPreviewProgramEmailRecipients(programId);
      setPreview(loaded);
      setSelected(new Set(candidatesOf(loaded).candidates.map((candidate) => candidate.clientId)));
    } catch {
      setPreviewFailed(true);
    }
  }, [programId]);

  useEffect(() => {
    if (!open) return;
    setStep("compose");
    resetAttempt();
    void loadRecipients();
  }, [open, resetAttempt, loadRecipients]);

  const { candidates, unreachable } = useMemo(
    () => (preview ? candidatesOf(preview) : { candidates: [], unreachable: [] }),
    [preview],
  );
  const everyone = candidates.length > 0 && candidates.every((c) => selected.has(c.clientId));
  const chosen = candidates.filter((candidate) => selected.has(candidate.clientId));
  const delivery = deliveryList(chosen);

  async function send() {
    try {
      const email = await attempt.run((idempotencyKey) =>
        cfSendProgramEmail(
          programId,
          {
            subject: subject.trim(),
            body: body.trim(),
            // Everyone checked means "every member", worked out again on the server at send time.
            ...(everyone ? {} : { clientIds: chosen.map((candidate) => candidate.clientId) }),
          },
          idempotencyKey,
        ),
      );
      if (!email) return; // a send is already running
      toast.success(
        `Sending to ${plural(email.recipientCount)}. Progress shows in the program's Emails tab.`,
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

  const canReview =
    subject.trim().length > 0 && body.trim().length > 0 && delivery.recipients.length > 0;

  return (
    <Dialog open={open} onOpenChange={(value) => !attempt.sending && onOpenChange(value)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Email program members</DialogTitle>
          <DialogDescription>
            {programName}. Each member gets their own copy, with the same header and sign-off as
            other ClientFlow emails.
          </DialogDescription>
        </DialogHeader>

        {step === "compose" ? (
          <div className="space-y-4">
            <RecipientPicker
              preview={preview}
              failed={previewFailed}
              onRetry={() => void loadRecipients()}
              candidates={candidates}
              unreachable={unreachable}
              selected={selected}
              onChange={setSelected}
              everyone={everyone}
            />
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
          <ReviewStep
            subject={subject.trim()}
            body={body.trim()}
            everyone={everyone}
            recipients={delivery.recipients}
            sharing={delivery.sharing}
            unreachable={everyone ? unreachable : []}
          />
        )}

        <DialogFooter>
          {step === "compose" ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={!canReview} onClick={() => setStep("review")}>
                Review &amp; send
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
                disabled={attempt.sending || delivery.recipients.length === 0}
                onClick={() => void send()}
              >
                {attempt.sending ? "Sending…" : `Send to ${plural(delivery.recipients.length)}`}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecipientPicker({
  preview,
  failed,
  onRetry,
  candidates,
  unreachable,
  selected,
  onChange,
  everyone,
}: {
  preview: ProgramEmailRecipientsPreview | null;
  failed: boolean;
  onRetry: () => void;
  candidates: Candidate[];
  unreachable: Unreachable[];
  selected: Set<string>;
  onChange: (selected: Set<string>) => void;
  everyone: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [query, setQuery] = useState("");

  if (failed) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-md border border-border p-3 text-sm">
        <span className="text-destructive">The member list couldn't be loaded.</span>
        <Button size="sm" variant="outline" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  if (!preview) {
    return <p className="text-sm text-muted-foreground">Loading members…</p>;
  }
  if (candidates.length === 0) {
    return (
      <p role="alert" className="text-sm text-destructive">
        Nobody in this program has a usable email address.
      </p>
    );
  }

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? candidates.filter((candidate) =>
        [candidate.businessName, candidate.name, candidate.email].some((text) =>
          text.toLowerCase().includes(needle),
        ),
      )
    : candidates;
  const toggle = (clientId: string, on: boolean) => {
    const next = new Set(selected);
    if (on) next.add(clientId);
    else next.delete(clientId);
    onChange(next);
  };
  const summary = everyone
    ? `All members (${candidates.length})`
    : selected.size === 0
      ? "Nobody chosen yet"
      : `${selected.size} of ${candidates.length} chosen`;

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label className="flex items-center gap-2 text-sm font-medium">
          <Checkbox
            aria-label="All members"
            checked={everyone ? true : selected.size > 0 ? "indeterminate" : false}
            onCheckedChange={(value) =>
              onChange(
                new Set(value === true ? candidates.map((candidate) => candidate.clientId) : []),
              )
            }
          />
          <span>
            To: <span aria-label="Recipient summary">{summary}</span>
          </span>
        </label>
        <Button size="sm" variant="ghost" onClick={() => setExpanded(!expanded)}>
          {expanded ? "Hide members" : "Choose members"}
        </Button>
      </div>
      {expanded && (
        <div className="space-y-2">
          <Input
            aria-label="Search members"
            placeholder="Search by business, name or email"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          <ul
            aria-label="Members"
            className="max-h-56 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm"
          >
            {shown.map((candidate) => (
              <li key={candidate.clientId}>
                <label className="flex cursor-pointer items-center gap-3 px-3 py-1.5 hover:bg-muted/40">
                  <Checkbox
                    aria-label={candidate.businessName}
                    checked={selected.has(candidate.clientId)}
                    onCheckedChange={(value) => toggle(candidate.clientId, value === true)}
                  />
                  <span className="min-w-0 flex-1">
                    {candidate.businessName}
                    {candidate.name !== candidate.businessName && (
                      <span className="text-muted-foreground"> · {candidate.name}</span>
                    )}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{candidate.email}</span>
                </label>
              </li>
            ))}
            {shown.length === 0 && (
              <li className="px-3 py-2 text-muted-foreground">No members match “{query}”.</li>
            )}
          </ul>
          {unreachable.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground">Can't be emailed</p>
              <ul
                aria-label="Members without a usable email"
                className="mt-1 space-y-0.5 text-xs text-muted-foreground"
              >
                {unreachable.map((member) => (
                  <li key={member.clientId}>
                    {member.businessName}
                    {member.email ? ` (${member.email})` : ""} — {SKIP_REASON_LABELS[member.reason]}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function MessageEditor({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<"write" | "preview">("write");
  const [linking, setLinking] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  // Where the cursor was when "Link" was clicked (the link field takes the focus).
  const linkTarget = useRef<TextEdit | null>(null);

  function current(): TextEdit {
    const element = textarea.current;
    return {
      value,
      selectionStart: element?.selectionStart ?? value.length,
      selectionEnd: element?.selectionEnd ?? value.length,
    };
  }

  function apply(edit: TextEdit | null) {
    if (!edit) return;
    onChange(edit.value.slice(0, BODY_MAX));
    requestAnimationFrame(() => {
      const element = textarea.current;
      if (!element) return;
      element.focus();
      element.setSelectionRange(edit.selectionStart, edit.selectionEnd);
    });
  }

  function addLink() {
    const edit = insertLink(linkTarget.current ?? current(), linkUrl);
    if (!edit) {
      toast.error("Enter a web address like ea.example.com or an email address.");
      return;
    }
    setLinking(false);
    setLinkUrl("");
    apply(edit);
  }

  const tools = [
    { label: "Bold", icon: Bold, run: () => apply(wrapSelection(current(), "**", "bold text")) },
    {
      label: "Italic",
      icon: Italic,
      run: () => apply(wrapSelection(current(), "_", "italic text")),
    },
    { label: "Bulleted list", icon: List, run: () => apply(toggleList(current(), "bullet")) },
    {
      label: "Numbered list",
      icon: ListOrdered,
      run: () => apply(toggleList(current(), "numbered")),
    },
    {
      label: "Link",
      icon: Link2,
      run: () => {
        linkTarget.current = current();
        setLinking(true);
      },
    },
  ];

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor="program-email-body">Message</Label>
        <div className="flex rounded-md border border-border p-0.5 text-xs" role="group">
          {(["write", "preview"] as const).map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={mode === option}
              onClick={() => setMode(option)}
              className={`rounded px-2 py-0.5 ${mode === option ? "bg-muted font-medium" : "text-muted-foreground"}`}
            >
              {option === "write" ? "Write" : "Preview"}
            </button>
          ))}
        </div>
      </div>
      {mode === "write" ? (
        <div className="rounded-md border border-input">
          <div
            role="toolbar"
            aria-label="Formatting"
            className="flex flex-wrap items-center gap-0.5 border-b border-input px-1 py-1"
          >
            {tools.map((tool) => (
              <Button
                key={tool.label}
                type="button"
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                aria-label={tool.label}
                title={tool.label}
                // Keep the text selection when the button is pressed.
                onMouseDown={(event) => event.preventDefault()}
                onClick={tool.run}
              >
                <tool.icon className="h-4 w-4" />
              </Button>
            ))}
          </div>
          {linking && (
            <div className="flex flex-wrap items-center gap-2 border-b border-input px-2 py-1.5">
              <Input
                autoFocus
                aria-label="Link address"
                placeholder="ea.example.com/signup or name@example.com"
                className="h-8 min-w-0 flex-1"
                value={linkUrl}
                onChange={(event) => setLinkUrl(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addLink();
                  }
                }}
              />
              <Button type="button" size="sm" onClick={addLink}>
                Add link
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setLinking(false);
                  setLinkUrl("");
                }}
              >
                Cancel
              </Button>
            </div>
          )}
          <Textarea
            ref={textarea}
            id="program-email-body"
            rows={9}
            className="rounded-none border-0 shadow-none focus-visible:ring-0"
            value={value}
            maxLength={BODY_MAX}
            onChange={(event) => onChange(event.target.value)}
            placeholder={"Hello everyone,\n\n…"}
          />
        </div>
      ) : (
        <div className="min-h-[13rem] rounded-md border border-input p-3">
          {value.trim() ? (
            <FormattedEmailBody body={value} />
          ) : (
            <p className="text-sm text-muted-foreground">Nothing written yet.</p>
          )}
        </div>
      )}
      <p className="text-xs text-muted-foreground">
        Select text and use the buttons, or type **bold**, _italic_, “- ” for a bullet, “1. ” for a
        numbered list. A blank line starts a new paragraph.
      </p>
    </div>
  );
}

/** The message as members will see it (formatting applied; the text is escaped). */
export function FormattedEmailBody({ body }: { body: string }) {
  return (
    <div
      className="space-y-3 text-sm [&_ol]:list-decimal [&_ol]:space-y-1 [&_ol]:pl-6 [&_ul]:list-disc [&_ul]:space-y-1 [&_ul]:pl-6"
      // formattedEmailHtml escapes all text and only emits p/br/strong/em/ul/ol/li/a(http, mailto).
      dangerouslySetInnerHTML={{ __html: formattedEmailHtml(body) }}
    />
  );
}

function ReviewStep({
  subject,
  body,
  everyone,
  recipients,
  sharing,
  unreachable,
}: {
  subject: string;
  body: string;
  everyone: boolean;
  recipients: Candidate[];
  sharing: Candidate[];
  unreachable: Unreachable[];
}) {
  return (
    <div className="space-y-4">
      <p className="text-sm">
        <span className="font-medium">“{subject}”</span> will go to{" "}
        <span className="font-medium" aria-label="Recipient count">
          {everyone ? `all ${plural(recipients.length)}` : `${plural(recipients.length)} you chose`}
        </span>
        .
      </p>
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <FormattedEmailBody body={body} />
      </div>
      <ul
        aria-label="Recipients"
        className="max-h-48 divide-y divide-border overflow-y-auto rounded-md border border-border text-sm"
      >
        {recipients.map((recipient) => (
          <li
            key={recipient.clientId}
            className="flex flex-wrap justify-between gap-x-3 px-3 py-1.5"
          >
            <span>
              {recipient.businessName}
              {recipient.name !== recipient.businessName && (
                <span className="text-muted-foreground"> · {recipient.name}</span>
              )}
            </span>
            <span className="text-muted-foreground">{recipient.email}</span>
          </li>
        ))}
      </ul>
      {(sharing.length > 0 || unreachable.length > 0) && (
        <div>
          <p className="text-xs font-medium text-muted-foreground">Skipped</p>
          <ul
            aria-label="Skipped members"
            className="mt-1 space-y-0.5 text-xs text-muted-foreground"
          >
            {sharing.map((member) => (
              <li key={member.clientId}>
                {member.businessName} ({member.email}) — {SKIP_REASON_LABELS.duplicate_email}
              </li>
            ))}
            {unreachable.map((member) => (
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
