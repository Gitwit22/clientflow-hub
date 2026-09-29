import { useEffect, useState } from "react";
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
import { toText } from "@/lib/answer-text";
import { applyFormResponsesToProfile, previewFormResponsesForProfile } from "@/lib/api";
import type { ProfileChangePreview } from "@/lib/apiClient";
import type { Client, FormAssignment } from "@/types";

interface MergeResponsesDialogProps {
  assignment: FormAssignment;
  client: Client;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

/**
 * Review the profile fields a submitted form would change, then apply the ones staff approve.
 * The server computes the differences and does the merge; this dialog only sends the approved
 * keys, so it never needs (or trusts) its own copy of the answers or the client's intake.
 */
export function MergeResponsesDialog({
  assignment,
  client,
  open,
  onOpenChange,
}: MergeResponsesDialogProps) {
  const [changes, setChanges] = useState<ProfileChangePreview[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setChanges(null);
    setLoadError(null);
    previewFormResponsesForProfile(client.id, assignment.id)
      .then((preview) => {
        if (cancelled) return;
        setChanges(preview);
        setSelected(new Set(preview.map((change) => change.key)));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message =
          error instanceof Error ? error.message : "Unable to load the submitted answers.";
        setLoadError(message);
        toast.error(message);
      });
    return () => {
      cancelled = true;
    };
  }, [open, client.id, assignment.id]);

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function handleApply() {
    const fields = (changes ?? [])
      .filter((change) => selected.has(change.key))
      .map((change) => change.key);
    if (fields.length === 0) {
      onOpenChange(false);
      return;
    }

    setApplying(true);
    try {
      await applyFormResponsesToProfile(client.id, assignment.id, fields);
      toast.success(`${fields.length} field${fields.length !== 1 ? "s" : ""} applied to profile`);
      onOpenChange(false);
    } catch (error) {
      // Stay on the page with the dialog open so staff can retry; nothing navigates or reloads.
      toast.error(
        error instanceof Error ? error.message : "Unable to apply the responses to the profile.",
      );
    } finally {
      setApplying(false);
    }
  }

  const loading = changes === null && loadError === null;
  const count = selected.size;

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

        {loading ? (
          <p className="py-4 text-center text-sm text-muted-foreground">
            Loading submitted answers…
          </p>
        ) : loadError ? (
          <p role="alert" className="py-4 text-center text-sm text-destructive">
            {loadError}
          </p>
        ) : changes && changes.length === 0 ? (
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
            {(changes ?? []).map((change) => (
              <div
                key={change.key}
                className="grid grid-cols-[auto_1fr_1fr_1fr] items-start gap-3 px-4 py-3"
              >
                <Checkbox
                  checked={selected.has(change.key)}
                  onCheckedChange={() => toggle(change.key)}
                  id={`merge-${change.key}`}
                />
                <label
                  htmlFor={`merge-${change.key}`}
                  className="cursor-pointer text-sm font-medium leading-snug"
                >
                  {change.label}
                </label>
                <span className="text-sm text-muted-foreground line-clamp-3">
                  {toText(change.currentValue) || "—"}
                </span>
                <span className="text-sm font-medium line-clamp-3">{toText(change.newValue)}</span>
              </div>
            ))}
          </div>
        )}

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleApply}
            disabled={applying || loading || !!loadError || count === 0}
          >
            {applying
              ? "Applying…"
              : `Apply ${count > 0 ? `${count} ` : ""}field${count !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
