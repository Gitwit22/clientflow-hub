import { useEffect, useState } from "react";
import { UnsavedChangesMarker } from "@/components/CollapsibleSection";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type EmailLayout = "left" | "left-edge" | "center";

export interface EmailStyleValues {
  /** null: no signature of its own (the organization's, or the email's standard sign-off). */
  emailSignature: string | null;
  /** null: no layout of its own (the organization's, or centered). */
  emailLayout: EmailLayout | null;
}

const DEFAULT_CHOICE = "default";
const SIGNATURE_MAX = 1000;

/**
 * The email sign-off and header layout. Used in Settings (the organization's default for every
 * email) and on a program page (that program's own, replacing the default; empty uses it).
 */
export function EmailStyleCard({
  title,
  description,
  value,
  forProgram = false,
  disabled = false,
  embedded = false,
  onSave,
}: {
  title: string;
  description: string;
  value: EmailStyleValues;
  /** A program can fall back to the organization's choices. */
  forProgram?: boolean;
  disabled?: boolean;
  /** Inside a section that already shows the title: no card of its own. */
  embedded?: boolean;
  onSave: (values: EmailStyleValues) => Promise<void>;
}) {
  const [signature, setSignature] = useState(value.emailSignature ?? "");
  const [layout, setLayout] = useState<string>(value.emailLayout ?? DEFAULT_CHOICE);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setSignature(value.emailSignature ?? "");
    setLayout(value.emailLayout ?? DEFAULT_CHOICE);
  }, [value.emailSignature, value.emailLayout]);

  async function save() {
    setSaving(true);
    try {
      await onSave({
        emailSignature: signature.trim() ? signature.trim() : null,
        emailLayout: layout === DEFAULT_CHOICE ? null : (layout as EmailLayout),
      });
      toast.success("Email signature and layout saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save.");
    } finally {
      setSaving(false);
    }
  }

  const id = forProgram ? "program-email" : "org-email";
  const unsaved =
    signature.trim() !== (value.emailSignature ?? "").trim() ||
    layout !== (value.emailLayout ?? DEFAULT_CHOICE);
  const fields = (
    <>
      <p className="text-muted-foreground">{description}</p>
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-signature`}>Signature</Label>
        <Textarea
          id={`${id}-signature`}
          rows={3}
          maxLength={SIGNATURE_MAX}
          value={signature}
          onChange={(event) => setSignature(event.target.value)}
          placeholder={
            forProgram
              ? "Empty uses the organization's signature (Settings)."
              : "Thank you,\nEA Management LLC"
          }
        />
      </div>
      <div className="space-y-1.5">
        <Label>Header and message layout</Label>
        <Select value={layout} onValueChange={setLayout}>
          <SelectTrigger aria-label="Email layout">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_CHOICE}>
              {forProgram ? "Same as the organization" : "Centered (standard)"}
            </SelectItem>
            <SelectItem value="left">Left, with a margin</SelectItem>
            <SelectItem value="left-edge">Left, logo at the edge</SelectItem>
            <SelectItem value="center">Centered</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {unsaved && <UnsavedChangesMarker />}
    </>
  );
  const saveButton = (
    <Button size="sm" disabled={disabled || saving} onClick={() => void save()}>
      {saving ? "Saving…" : "Save email settings"}
    </Button>
  );

  if (embedded) {
    return (
      <div className="space-y-3 text-sm" aria-label={title}>
        {fields}
        {saveButton}
      </div>
    );
  }
  return (
    <Card className="shadow-card" aria-label={title}>
      <CardHeader>
        <CardTitle className="font-display text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">{fields}</CardContent>
      <CardFooter className="pt-0">{saveButton}</CardFooter>
    </Card>
  );
}
