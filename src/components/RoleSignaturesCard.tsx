import { useEffect, useState } from "react";
import { toast } from "sonner";
import { UnsavedChangesMarker } from "@/components/CollapsibleSection";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

/** Sign-offs by staff role (Admin is org_admin, Staff is reviewer; super admins use Admin's). */
export interface RoleSignatures {
  org_admin: string | null;
  reviewer: string | null;
}

const SIGNATURE_MAX = 1000;

const ROLES: { key: keyof RoleSignatures; label: string; placeholder: string }[] = [
  { key: "org_admin", label: "Admin", placeholder: "Thank you,\nEAM Administration" },
  { key: "reviewer", label: "Staff", placeholder: "Thank you,\nEAM Staff" },
];

/**
 * The sign-off on emails a person sends, by their role. It replaces the program's and the
 * organization's signature on those emails; automatic emails keep those. Empty means none.
 */
export function RoleSignaturesCard({
  value,
  disabled = false,
  onSave,
}: {
  value: RoleSignatures;
  disabled?: boolean;
  onSave: (values: RoleSignatures) => Promise<void>;
}) {
  const [draft, setDraft] = useState<Record<keyof RoleSignatures, string>>({
    org_admin: value.org_admin ?? "",
    reviewer: value.reviewer ?? "",
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraft({ org_admin: value.org_admin ?? "", reviewer: value.reviewer ?? "" });
  }, [value.org_admin, value.reviewer]);

  const unsaved = ROLES.some(({ key }) => draft[key].trim() !== (value[key] ?? "").trim());

  async function save() {
    setSaving(true);
    try {
      await onSave({
        org_admin: draft.org_admin.trim() || null,
        reviewer: draft.reviewer.trim() || null,
      });
      toast.success("Role signatures saved.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the role signatures.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-3 border-t border-border pt-4">
      <div>
        <h3 className="font-medium">Signature by role</h3>
        <p className="text-sm text-muted-foreground">
          Used on emails a person sends: email blasts, forms, agreements, welcome emails and staff
          invites. It replaces the signature above for that person&apos;s emails. Automatic emails
          keep the program&apos;s or organization&apos;s signature. Leave a role empty to use those.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {ROLES.map((role) => (
          <div key={role.key} className="space-y-1.5">
            <Label htmlFor={`role-signature-${role.key}`}>{role.label} signature</Label>
            <Textarea
              id={`role-signature-${role.key}`}
              rows={3}
              maxLength={SIGNATURE_MAX}
              value={draft[role.key]}
              disabled={disabled || saving}
              placeholder={role.placeholder}
              onChange={(event) =>
                setDraft((current) => ({ ...current, [role.key]: event.target.value }))
              }
            />
          </div>
        ))}
      </div>
      <div className="flex items-center gap-3">
        <Button onClick={() => void save()} disabled={disabled || saving || !unsaved}>
          {saving ? "Saving…" : "Save role signatures"}
        </Button>
        {unsaved && <UnsavedChangesMarker />}
      </div>
    </div>
  );
}
