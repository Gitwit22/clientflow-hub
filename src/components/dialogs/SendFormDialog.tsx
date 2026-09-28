import { useEffect, useMemo, useRef, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { createFormAssignment, renderEmailBody, sendFormEmail } from "@/lib/api";
import { isDefinitiveFailure, newIdempotencyKey } from "@/lib/client-send";
import { useAppState } from "@/lib/store";
import type { Client, ProgramEnrollment } from "@/types";

/**
 * `kind` picks which forms can be sent: a program form for the selected enrollment's program, or a
 * general form that isn't tied to a program. Without it the dialog keeps its original behavior (the
 * Master Intake, or the template passed in).
 */
export function SendFormDialog({
  client,
  templateId,
  kind,
  enrollment,
  open,
  onOpenChange,
}: {
  client: Client | null;
  templateId?: string | null;
  kind?: "program" | "general";
  enrollment?: ProgramEnrollment | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { formTemplates, programs, enrollments } = useAppState();
  const [dueDate, setDueDate] = useState<string>(
    new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
  );
  const [subject, setSubject] = useState("Next step for your program application");
  const [preview, setPreview] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [pendingAssignmentId, setPendingAssignmentId] = useState<string | null>(null);
  const [chosenTemplateId, setChosenTemplateId] = useState<string | null>(null);
  // One key per send attempt: a retry after a lost response reuses it, a deliberate resend gets a new one.
  const attemptKey = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      setPendingAssignmentId(null);
      setChosenTemplateId(null);
      attemptKey.current = null;
    }
  }, [open, client?.id, templateId, kind]);

  // Program forms belong to the selected enrollment's program; general forms have no program.
  const candidateTemplates = kind
    ? formTemplates
        .filter((candidate) => candidate.isActive)
        .filter((candidate) =>
          kind === "program"
            ? !!enrollment && candidate.programId === enrollment.programId
            : !candidate.programId,
        )
        .sort((a, b) => Number(b.scope === "master_core") - Number(a.scope === "master_core"))
    : [];
  const template = kind
    ? (candidateTemplates.find((candidate) => candidate.id === chosenTemplateId) ?? candidateTemplates[0])
    : templateId
      ? formTemplates.find((candidate) => candidate.id === templateId && candidate.isActive)
      : (formTemplates.find((candidate) => candidate.scope === "master_core" && candidate.isActive) ??
        formTemplates.find((candidate) => candidate.programId === null && candidate.isActive));
  // Program context: the selected enrollment when there is one (never the legacy client.programId).
  const contextEnrollment =
    enrollment ??
    enrollments.find(
      (candidate) =>
        candidate.clientId === client?.id &&
        !candidate.isArchived &&
        !["completed", "declined", "withdrawn"].includes(candidate.status),
    );
  const program = programs.find((candidate) => candidate.id === contextEnrollment?.programId);
  const secureLink = "https://forms.clientflow.app/s/{{generated-on-send}}";

  const body = useMemo(
    () =>
      renderEmailBody({
        contactName: client?.primaryContactName ?? "{{contactName}}",
        programName: program?.name ?? "{{programName}}",
        dueDate,
        secureFormLink: secureLink,
      }),
    [client, program, dueDate],
  );
  const [bodyOverride, setBodyOverride] = useState<string | null>(null);

  const prefilled = client
    ? [
        ["Contact name", client.primaryContactName],
        ["Business name", client.businessName],
        ["Email", client.email],
        ["Phone", client.phone],
        ["Website", client.website ?? "—"],
        ["Program of interest", client.intake.programOfInterest],
      ]
    : [];

  async function handleSend() {
    if (!client || !template) return;
    setIsSending(true);
    try {
      let assignmentId = pendingAssignmentId;
      if (!assignmentId) {
        const assignment = await createFormAssignment({
          clientId: client.id,
          formId: template.id,
          completionMethod: "secure_link",
          deliveryMethod: "email",
          recipientEmail: client.email,
          assignedUserId: client.assignedUserId ?? null,
          dueDate: new Date(dueDate).toISOString(),
          status: "draft",
          organizationId: "org_ea_management",
          isDemo: client.isDemo ?? false,
          // A program form is tied to the selected enrollment; a general form is not.
          ...(kind === "program" && enrollment ? { enrollmentId: enrollment.id } : {}),
        });
        assignmentId = assignment.id;
        setPendingAssignmentId(assignment.id);
      }
      attemptKey.current ??= newIdempotencyKey();
      const result = await sendFormEmail(assignmentId, undefined, attemptKey.current);
      setPendingAssignmentId(null);
      attemptKey.current = null;
      toast.success(
        `${result.message} Sent to ${result.recipientEmail} via ${result.provider === "N8N_GMAIL" ? "n8n Gmail" : "Resend"}.`,
      );
      onOpenChange(false);
      setPreview(false);
      setBodyOverride(null);
    } catch (error) {
      // The server answered with a failure: the next click is a new attempt. With no answer at all
      // (network drop) the key is kept, so a retry can't email the client twice.
      if (isDefinitiveFailure(error)) attemptKey.current = null;
      toast.error(
        error instanceof Error ? error.message : "Failed to send form. Please try again.",
      );
    } finally {
      setIsSending(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">
            {kind === "general" ? "Send general form" : "Send program form"}
          </DialogTitle>
          <DialogDescription>
            The secure link prefills everything already collected during intake.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {!template && (
            <p className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              {kind === "program"
                ? `No active form is configured for ${program?.name ?? "this program"}.`
                : kind === "general"
                  ? "No active general form is configured."
                  : templateId
                    ? "The selected form template is no longer active."
                    : "No active Master Intake form is configured."}
            </p>
          )}
          {template && kind && candidateTemplates.length > 1 ? (
            <div className="space-y-1.5">
              <Label>Form</Label>
              <Select value={template.id} onValueChange={setChosenTemplateId}>
                <SelectTrigger aria-label="Form">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {candidateTemplates.map((candidate) => (
                    <SelectItem key={candidate.id} value={candidate.id}>
                      {candidate.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          ) : template ? (
            <div className="space-y-1.5">
              <Label>Form</Label>
              <Input value={template.name} readOnly />
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Recipient email</Label>
              <Input value={client?.email ?? ""} readOnly />
            </div>
            <div className="space-y-1.5">
              <Label>Due date</Label>
              <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Subject line</Label>
            <Input value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label>Email body</Label>
            <Textarea
              rows={12}
              value={bodyOverride ?? body}
              onChange={(e) => setBodyOverride(e.target.value)}
            />
          </div>

          <div className="rounded-xl border border-border bg-muted/50 p-4">
            <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              Prefilled from client profile
            </p>
            <dl className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
              {prefilled.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3 text-sm">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="truncate font-medium">{v}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-muted-foreground">
              Secure form link: <span className="font-mono">{secureLink}</span>
            </p>
          </div>

          {preview ? (
            <div className="rounded-xl border border-primary/25 bg-primary/5 p-4">
              <p className="text-xs font-semibold text-primary uppercase">Send preview</p>
              <p className="mt-2 text-sm font-medium">To: {client?.email}</p>
              <p className="text-sm font-medium">Subject: {subject}</p>
              <pre className="mt-2 font-sans text-sm whitespace-pre-wrap text-muted-foreground">
                {bodyOverride ?? body}
              </pre>
            </div>
          ) : null}
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => setPreview((p) => !p)} disabled={isSending}>
            {preview ? "Hide preview" : "Send preview"}
          </Button>
          <Button type="button" onClick={handleSend} disabled={!template || isSending}>
            {isSending ? "Sending..." : "Send form"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
