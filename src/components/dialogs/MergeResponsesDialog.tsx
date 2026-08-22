import { useState } from "react";
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
import { updateClient } from "@/lib/api";
import type { Client, FormAssignment, FormTemplate } from "@/types";

interface MergeField {
  key: string;
  label: string;
  currentValue: string;
  newValue: string;
  target: "top" | "intake";
  intakeKey?: string;
}

function buildMergeFields(
  assignment: FormAssignment,
  template: FormTemplate,
  client: Client,
): MergeField[] {
  const responses = assignment.responses ?? {};
  const fields: MergeField[] = [];

  const topLevelMap: Record<string, { label: string; key: keyof Client }> = {
    email: { label: "Email", key: "email" },
    phone: { label: "Phone", key: "phone" },
    business: { label: "Business name", key: "businessName" },
    bizName: { label: "Business name", key: "businessName" },
    brandName: { label: "Business name", key: "businessName" },
    contact: { label: "Contact name", key: "primaryContactName" },
    fullName: { label: "Contact name", key: "primaryContactName" },
    name: { label: "Contact name", key: "primaryContactName" },
    applicant: { label: "Contact name", key: "primaryContactName" },
    website: { label: "Website", key: "website" },
  };

  const intakeMap: Record<string, { label: string; intakeKey: string }> = {
    description: { label: "Business description", intakeKey: "businessDescription" },
    businessDescription: { label: "Business description", intakeKey: "businessDescription" },
    assistance: { label: "Assistance requested", intakeKey: "assistanceRequested" },
    assistanceRequested: { label: "Assistance requested", intakeKey: "assistanceRequested" },
    businessType: { label: "Business type", intakeKey: "businessType" },
    bizType: { label: "Business type", intakeKey: "businessType" },
    industry: { label: "Business type", intakeKey: "businessType" },
    program: { label: "Program of interest", intakeKey: "programOfInterest" },
    programOfInterest: { label: "Program of interest", intakeKey: "programOfInterest" },
    budget: { label: "Budget need", intakeKey: "budgetNeed" },
    budgetNeed: { label: "Budget need", intakeKey: "budgetNeed" },
    contact_pref: { label: "Preferred contact", intakeKey: "preferredContact" },
    preferredContact: { label: "Preferred contact", intakeKey: "preferredContact" },
    heard: { label: "How they heard about us", intakeKey: "heardAboutUs" },
    heardAboutUs: { label: "How they heard about us", intakeKey: "heardAboutUs" },
    comments: { label: "Additional comments", intakeKey: "additionalComments" },
    additionalComments: { label: "Additional comments", intakeKey: "additionalComments" },
  };

  const seen = new Set<string>();

  for (const field of template.fields) {
    const responseVal = responses[field.id];
    if (!responseVal?.trim()) continue;

    // Check top-level match by field ID or prefillKey
    const topKey = topLevelMap[field.id] ?? (field.prefillKey ? topLevelMap[field.prefillKey] : undefined);
    if (topKey && !seen.has(topKey.key)) {
      const currentVal = String(client[topKey.key] ?? "");
      if (responseVal !== currentVal) {
        fields.push({
          key: topKey.key,
          label: topKey.label,
          currentValue: currentVal,
          newValue: responseVal,
          target: "top",
        });
      }
      seen.add(topKey.key);
      continue;
    }

    // Check intake match
    const intakeKey =
      intakeMap[field.id] ?? (field.prefillKey ? intakeMap[field.prefillKey] : undefined);
    if (intakeKey && !seen.has(intakeKey.intakeKey)) {
      const currentVal = String(client.intake[intakeKey.intakeKey as keyof typeof client.intake] ?? "");
      if (responseVal !== currentVal) {
        fields.push({
          key: intakeKey.intakeKey,
          label: intakeKey.label,
          currentValue: currentVal,
          newValue: responseVal,
          target: "intake",
          intakeKey: intakeKey.intakeKey,
        });
      }
      seen.add(intakeKey.intakeKey);
    }
  }

  return fields;
}

interface MergeResponsesDialogProps {
  assignment: FormAssignment;
  template: FormTemplate;
  client: Client;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function MergeResponsesDialog({
  assignment,
  template,
  client,
  open,
  onOpenChange,
}: MergeResponsesDialogProps) {
  const mergeFields = buildMergeFields(assignment, template, client);
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(mergeFields.map((f) => f.key)),
  );
  const [applying, setApplying] = useState(false);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  }

  async function handleApply() {
    const toApply = mergeFields.filter((f) => selected.has(f.key));
    if (toApply.length === 0) {
      onOpenChange(false);
      return;
    }

    setApplying(true);
    try {
      const topChanges: Partial<Client> = {};
      const intakeChanges: Partial<typeof client.intake> = {};

      for (const f of toApply) {
        if (f.target === "top") {
          (topChanges as Record<string, string>)[f.key] = f.newValue;
        } else {
          (intakeChanges as Record<string, string>)[f.intakeKey!] = f.newValue;
        }
      }

      const update: Partial<Client> = { ...topChanges };
      if (Object.keys(intakeChanges).length > 0) {
        update.intake = { ...client.intake, ...intakeChanges };
      }

      await updateClient(client.id, update);
      toast.success(`${toApply.length} field${toApply.length !== 1 ? "s" : ""} applied to profile`);
      onOpenChange(false);
    } finally {
      setApplying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Review & apply to profile</DialogTitle>
          <DialogDescription>
            Select which form responses to apply to the client profile. Only fields with new values
            are shown.
          </DialogDescription>
        </DialogHeader>

        {mergeFields.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            No differences found — the client profile is already up to date.
          </p>
        ) : (
          <div className="divide-y divide-border rounded-xl border border-border">
            <div className="grid grid-cols-[auto_1fr_1fr_1fr] gap-3 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <span />
              <span>Field</span>
              <span>Current</span>
              <span>Form response</span>
            </div>
            {mergeFields.map((f) => (
              <div
                key={f.key}
                className="grid grid-cols-[auto_1fr_1fr_1fr] items-start gap-3 px-4 py-3"
              >
                <Checkbox
                  checked={selected.has(f.key)}
                  onCheckedChange={() => toggle(f.key)}
                  id={`merge-${f.key}`}
                />
                <label
                  htmlFor={`merge-${f.key}`}
                  className="cursor-pointer text-sm font-medium leading-snug"
                >
                  {f.label}
                </label>
                <span className="text-sm text-muted-foreground line-clamp-3">
                  {f.currentValue || "—"}
                </span>
                <span className="text-sm font-medium line-clamp-3">{f.newValue}</span>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={applying || selected.size === 0}>
            {applying ? "Applying…" : `Apply ${selected.size > 0 ? `${selected.size} ` : ""}field${selected.size !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
