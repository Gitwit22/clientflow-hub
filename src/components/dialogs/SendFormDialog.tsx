import { useMemo, useState } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  assignFormToClient,
  createFormAssignment,
  renderEmailBody,
  sendFormEmail,
} from "@/lib/api";
import { useAppState } from "@/lib/store";
import type { Client } from "@/types";

export function SendFormDialog({
  client,
  open,
  onOpenChange,
}: {
  client: Client | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const { formTemplates, programs } = useAppState();
  const [templateId, setTemplateId] = useState<string>("");
  const [dueDate, setDueDate] = useState<string>(
    new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
  );
  const [subject, setSubject] = useState("Next step for your program application");
  const [preview, setPreview] = useState(false);

  const template = formTemplates.find((t) => t.id === templateId);
  const program = programs.find((p) => p.id === template?.programId);
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
    try {
      const assignment = await createFormAssignment({
        clientId: client.id,
        formId: template.id,
        completionMethod: "secure_link",
        deliveryMethod: "email",
        recipientEmail: client.email,
        assignedUserId: null,
        dueDate: new Date(dueDate).toISOString(),
        status: "draft",
        organizationId: "org_ea_management",
        isDemo: client.isDemo ?? false,
        createdByUserId: "user_alicia",
      });
      await sendFormEmail(assignment.id);
      toast.success(`${template.name} sent to ${client.email}`);
      onOpenChange(false);
      setPreview(false);
      setTemplateId("");
      setBodyOverride(null);
    } catch {
      toast.error("Failed to send form. Please try again.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Send program form</DialogTitle>
          <DialogDescription>
            The secure link prefills everything already collected during intake.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
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
            <Label>Program form</Label>
            <Select value={templateId} onValueChange={setTemplateId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a form" />
              </SelectTrigger>
              <SelectContent>
                {formTemplates.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
          <Button variant="outline" onClick={() => setPreview((p) => !p)}>
            {preview ? "Hide preview" : "Send preview"}
          </Button>
          <Button onClick={handleSend} disabled={!template}>
            Send form
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
