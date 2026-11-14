import { useCallback, useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { updateProgramWorkflow } from "@/lib/api";
import {
  cfCreateAutomationEmail,
  cfDeleteAutomationEmail,
  cfGetProgramAutomation,
  cfSendAutomationEmailTest,
  cfUpdateAutomationEmail,
  type ProgramAutomation,
  type ProgramAutomationRule,
} from "@/lib/apiClient";
import { describeDelivery } from "@/lib/client-send";
import type { Program, ProgramWorkflow } from "@/types";

const FIELD_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

/** The text with merge fields filled from sample details, as the preview and test show it. */
function withSamples(text: string, fields: ProgramAutomation["emailFields"], programName: string) {
  return text.replace(FIELD_PATTERN, (placeholder, name: string) => {
    if (name === "program.name") return programName;
    return fields.find((field) => field.key === name)?.sample ?? placeholder;
  });
}

/**
 * What a program emails automatically, on one card: the program's automation switch, the built-in
 * emails (agreement link after intake, welcome after signing, signed copy) and its custom emails
 * ("send this email when X happens").
 */
export function ProgramAutomaticEmails({
  program,
  workflow,
  onChanged,
}: {
  program: Program;
  workflow: ProgramWorkflow | undefined;
  onChanged: () => void;
}) {
  const [automation, setAutomation] = useState<ProgramAutomation | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingSwitch, setSavingSwitch] = useState(false);
  const [editing, setEditing] = useState<ProgramAutomationRule | "new" | null>(null);
  const [deleting, setDeleting] = useState<ProgramAutomationRule | null>(null);

  const load = useCallback(() => {
    cfGetProgramAutomation(program.id)
      .then((result) => {
        setAutomation(result);
        setLoadError(null);
      })
      .catch((error: unknown) =>
        setLoadError(error instanceof Error ? error.message : "Couldn't load automatic emails."),
      );
  }, [program.id]);

  useEffect(load, [load]);

  const config = workflow?.config;
  const automationOn = config?.enabled ?? true;
  const emails = (automation?.rules ?? []).filter((rule) => rule.action === "send_email");
  const triggerLabel = (trigger: string) =>
    automation?.emailTriggers.find((item) => item.trigger === trigger)?.label ?? trigger;

  function setSwitch(data: Record<string, boolean>) {
    setSavingSwitch(true);
    void updateProgramWorkflow(program.id, data)
      .then(onChanged)
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : "Unable to update automatic emails."),
      )
      .finally(() => setSavingSwitch(false));
  }

  async function setEmailEnabled(rule: ProgramAutomationRule, enabled: boolean) {
    try {
      await cfUpdateAutomationEmail(program.id, rule.id, { enabled });
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update this email.");
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    try {
      await cfDeleteAutomationEmail(program.id, deleting.id);
      toast.success("Email deleted.");
      setDeleting(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete this email.");
    }
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3" aria-label="Automatic emails">
      <div className="flex items-center justify-between gap-2">
        <p className="font-mono text-[10px] uppercase text-muted-foreground">4. Automatic emails</p>
        <div className="flex items-center gap-2 text-sm">
          <span>{automationOn ? "On" : "Paused"}</span>
          <Switch
            aria-label="Automation for this program"
            checked={automationOn}
            disabled={savingSwitch || !workflow}
            onCheckedChange={(checked) => setSwitch({ enabled: checked })}
          />
        </div>
      </div>
      {!automationOn && (
        <p className="text-xs text-destructive">
          Paused: nothing below is sent automatically for this program until it is switched on.
        </p>
      )}

      <div className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p>Agreement signing link after intake</p>
            {config?.sendContractAfterIntake && !config.activeContractVersionId && (
              <p className="text-xs text-destructive">
                No enrollment agreement is set yet, so none can be sent.
              </p>
            )}
          </div>
          <Switch
            aria-label="Send the agreement after intake"
            checked={config?.sendContractAfterIntake ?? false}
            disabled={savingSwitch || !workflow}
            onCheckedChange={(checked) => setSwitch({ sendContractAfterIntake: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div>
            <p>Welcome email after signing</p>
            <p className="text-xs text-muted-foreground">Written under Welcome versions below.</p>
          </div>
          <Switch
            aria-label="Send the welcome email after signing"
            checked={config?.sendWelcomeAfterContractSigned ?? false}
            disabled={savingSwitch || !workflow}
            onCheckedChange={(checked) => setSwitch({ sendWelcomeAfterContractSigned: checked })}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <p>Signed copy of the agreement to the client</p>
          <span className="text-xs text-muted-foreground">Always sent</span>
        </div>
      </div>

      <div className="space-y-2 border-t border-border pt-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">Custom emails</p>
          <Button
            size="sm"
            variant="outline"
            disabled={!automation}
            onClick={() => setEditing("new")}
          >
            Add email
          </Button>
        </div>
        {loadError && (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        )}
        {automation && emails.length === 0 && (
          <p className="text-xs text-muted-foreground">
            No custom emails yet. Add one to email clients automatically when something happens, for
            example when they submit their intake.
          </p>
        )}
        <ul className="space-y-2">
          {emails.map((rule) => (
            <li
              key={rule.id}
              className="flex items-center justify-between gap-2 rounded-md border border-border p-2"
            >
              <div className="min-w-0 text-sm">
                <p className="truncate font-medium">
                  {rule.actionConfig.subject || "(no subject)"}
                </p>
                <p className="text-xs text-muted-foreground">{triggerLabel(rule.trigger)}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Switch
                  aria-label={`Send "${rule.actionConfig.subject ?? ""}"`}
                  checked={rule.enabled}
                  onCheckedChange={(checked) => void setEmailEnabled(rule, checked)}
                />
                <Button size="sm" variant="ghost" onClick={() => setEditing(rule)}>
                  Edit
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setDeleting(rule)}>
                  Delete
                </Button>
              </div>
            </li>
          ))}
        </ul>
      </div>

      {automation && (
        <AutomaticEmailDialog
          key={editing === "new" ? "new" : (editing?.id ?? "closed")}
          program={program}
          automation={automation}
          rule={editing === "new" ? null : editing}
          open={editing !== null}
          onOpenChange={(open) => !open && setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Delete this email?</DialogTitle>
            <DialogDescription>
              "{deleting?.actionConfig.subject}" will no longer be sent. Emails already sent are not
              affected. To stop it for a while instead, switch it off.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Keep it
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()}>
              Delete email
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AutomaticEmailDialog({
  program,
  automation,
  rule,
  open,
  onOpenChange,
  onSaved,
}: {
  program: Program;
  automation: ProgramAutomation;
  rule: ProgramAutomationRule | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [trigger, setTrigger] = useState(
    rule?.trigger ?? automation.emailTriggers[0]?.trigger ?? "intake_submitted",
  );
  const [subject, setSubject] = useState(rule?.actionConfig.subject ?? "");
  const [message, setMessage] = useState(rule?.actionConfig.message ?? "");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const ready = subject.trim() !== "" && message.trim() !== "";

  async function save() {
    setSaving(true);
    try {
      if (rule) await cfUpdateAutomationEmail(program.id, rule.id, { trigger, subject, message });
      else await cfCreateAutomationEmail(program.id, { trigger, subject, message });
      toast.success(rule ? "Email updated." : "Email added.");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save this email.");
    } finally {
      setSaving(false);
    }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const result = await cfSendAutomationEmailTest(program.id, { subject, message });
      const outcome = describeDelivery(result.delivery);
      if (outcome.ok) toast.success(`Test sent to ${result.recipientEmail}.`);
      else toast.error(outcome.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send the test.");
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="font-display">
            {rule ? "Edit automatic email" : "Add automatic email"}
          </DialogTitle>
          <DialogDescription>
            Sent to the client automatically for {program.name}, once per event.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Send it</Label>
            <Select value={trigger} onValueChange={setTrigger}>
              <SelectTrigger aria-label="When to send it">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {automation.emailTriggers.map((item) => (
                  <SelectItem key={item.trigger} value={item.trigger}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="automatic-email-subject">Subject</Label>
            <Input
              id="automatic-email-subject"
              value={subject}
              maxLength={200}
              onChange={(event) => setSubject(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="automatic-email-message">Message</Label>
            <Textarea
              id="automatic-email-message"
              rows={7}
              value={message}
              onChange={(event) => setMessage(event.target.value)}
            />
          </div>
          <details className="rounded-md border border-border p-2 text-sm">
            <summary className="cursor-pointer">Merge fields you can use</summary>
            <ul className="mt-2 space-y-1">
              {automation.emailFields.map((field) => (
                <li key={field.key} className="flex justify-between gap-2">
                  <code className="text-xs">{`{{${field.key}}}`}</code>
                  <span className="text-xs text-muted-foreground">{field.label}</span>
                </li>
              ))}
            </ul>
          </details>
          {ready && (
            <div className="space-y-1 rounded-md bg-muted/40 p-3 text-sm" aria-label="Preview">
              <p className="text-xs text-muted-foreground">Preview with sample details</p>
              <p className="font-medium">
                {withSamples(subject, automation.emailFields, program.name)}
              </p>
              <p className="whitespace-pre-wrap">
                {withSamples(message, automation.emailFields, program.name)}
              </p>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          <Button
            variant="outline"
            disabled={!ready || testing || saving}
            onClick={() => void sendTest()}
          >
            {testing ? "Sending…" : "Send test to me"}
          </Button>
          <div className="flex gap-2">
            <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={!ready || saving} onClick={() => void save()}>
              {saving ? "Saving…" : rule ? "Save email" : "Add email"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
