import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { TestClientBadge } from "@/components/clients/TestClientBadge";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  cfConfirmDeliverableForMembers,
  cfListDeliverableConfirmationMembers,
} from "@/lib/apiClient";
import {
  CONFIRMATION_BLOCKED_LABELS,
  type DeliverableConfirmationList,
  type ProgramDeliverableTemplate,
} from "@/lib/program-deliverables";

/** "2026-10" for this month and last month, with their names. */
function recentMonths() {
  const now = new Date();
  return [0, -1].map((offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return {
      value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    };
  });
}

const plural = (count: number) => `${count} ${count === 1 ? "member" : "members"}`;

/**
 * Confirms one deliverable (a monthly meeting everyone attended) for many members at once: every
 * member who can receive it starts ticked; untick anyone who missed it.
 */
export function ConfirmDeliverableDialog({
  programId,
  template,
  open,
  onOpenChange,
  onConfirmed,
}: {
  programId: string;
  template: ProgramDeliverableTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirmed?: () => void;
}) {
  const months = useMemo(recentMonths, []);
  const [month, setMonth] = useState(months[0].value);
  const [list, setList] = useState<DeliverableConfirmationList | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [status, setStatus] = useState<"COMPLETED" | "DELIVERED">("COMPLETED");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setMonth(months[0].value);
      setNote("");
      setStatus("COMPLETED");
    }
  }, [open, months]);

  useEffect(() => {
    if (!open || !template) return;
    let cancelled = false;
    setList(null);
    setLoadError("");
    cfListDeliverableConfirmationMembers(programId, template.id, month)
      .then((loaded) => {
        if (cancelled) return;
        setList(loaded);
        setSelected(
          new Set(
            loaded.members
              .filter((member) => !member.done && !member.blockedReason)
              .map((member) => member.enrollmentId),
          ),
        );
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoadError(error instanceof Error ? error.message : "Unable to load the members.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, template, programId, month]);

  const confirmable = (list?.members ?? []).filter(
    (member) => !member.done && !member.blockedReason,
  );
  const allTicked =
    confirmable.length > 0 && confirmable.every((member) => selected.has(member.enrollmentId));

  async function confirm() {
    if (!template || !selected.size) return;
    setSaving(true);
    try {
      const result = await cfConfirmDeliverableForMembers(programId, template.id, {
        month,
        enrollmentIds: [...selected],
        status,
        note: note.trim() || undefined,
      });
      const parts = [
        `${template.title} confirmed for ${plural(result.confirmed.length)} (${result.label}).`,
      ];
      if (result.alreadyDone.length)
        parts.push(`${plural(result.alreadyDone.length)} already done.`);
      if (result.skipped.length) parts.push(`${plural(result.skipped.length)} skipped.`);
      toast.success(parts.join(" "));
      onConfirmed?.();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to confirm.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !saving && onOpenChange(value)}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">
            Confirm {template?.title ?? "deliverable"}
          </DialogTitle>
          <DialogDescription>
            Mark it done for everyone who received it in one step. Untick anyone who missed it.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label>Month</Label>
            <Select value={month} onValueChange={setMonth} disabled={saving}>
              <SelectTrigger aria-label="Month">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {months.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Mark as</Label>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as "COMPLETED" | "DELIVERED")}
              disabled={saving}
            >
              <SelectTrigger aria-label="Mark as">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="DELIVERED">Delivered</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {loadError ? (
          <p role="alert" className="text-sm text-destructive">
            {loadError}
          </p>
        ) : !list ? (
          <p className="text-sm text-muted-foreground">Loading members…</p>
        ) : list.members.length === 0 ? (
          <p className="text-sm text-muted-foreground">No active members in this program.</p>
        ) : (
          <div className="space-y-2 rounded-md border border-border p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <Checkbox
                aria-label="All members"
                checked={allTicked ? true : selected.size > 0 ? "indeterminate" : false}
                disabled={saving || confirmable.length === 0}
                onCheckedChange={(value) =>
                  setSelected(
                    new Set(value === true ? confirmable.map((member) => member.enrollmentId) : []),
                  )
                }
              />
              Everyone who can be confirmed ({confirmable.length})
            </label>
            <ul
              aria-label="Members"
              className="max-h-72 divide-y divide-border overflow-y-auto text-sm"
            >
              {list.members.map((member) => {
                const disabled = saving || member.done || Boolean(member.blockedReason);
                return (
                  <li key={member.enrollmentId}>
                    <label className="flex items-center gap-3 py-1.5">
                      <Checkbox
                        aria-label={member.businessName}
                        checked={member.done || selected.has(member.enrollmentId)}
                        disabled={disabled}
                        onCheckedChange={(value) =>
                          setSelected((current) => {
                            const next = new Set(current);
                            if (value === true) next.add(member.enrollmentId);
                            else next.delete(member.enrollmentId);
                            return next;
                          })
                        }
                      />
                      <span className="min-w-0 flex-1">
                        {member.businessName}
                        <TestClientBadge client={{ isDemo: member.isTest }} className="ml-2" />
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {member.done
                          ? "Already done"
                          : member.blockedReason
                            ? CONFIRMATION_BLOCKED_LABELS[member.blockedReason]
                            : ""}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        <div className="space-y-1.5">
          <Label htmlFor="confirm-deliverable-note">Note (optional)</Label>
          <Input
            id="confirm-deliverable-note"
            value={note}
            maxLength={500}
            disabled={saving}
            placeholder="e.g. October 14 group meeting"
            onChange={(event) => setNote(event.target.value)}
          />
        </div>

        <DialogFooter>
          <Button variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving || selected.size === 0} onClick={() => void confirm()}>
            {saving ? "Confirming…" : `Confirm for ${plural(selected.size)}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
