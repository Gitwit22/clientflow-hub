import { useEffect, useState, type FormEvent } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cfSetDeliverableNextAction, cfUpdateEnrollmentDeliverable } from "@/lib/apiClient";
import {
  DELIVERABLE_STATUSES,
  DELIVERABLE_STATUS_LABELS,
  formatDeliverableDate,
  isResolvedStatus,
  type DeliverableStatus,
  type EnrollmentDeliverable,
} from "@/lib/program-deliverables";

/** Status, optional date, notes, outcome and next-action mark for one client deliverable. */
export function DeliverableEditDialog({
  enrollmentId,
  deliverable,
  onOpenChange,
  onSaved,
}: {
  enrollmentId: string;
  deliverable: EnrollmentDeliverable | null;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const [status, setStatus] = useState<DeliverableStatus>("NOT_STARTED");
  const [scheduledFor, setScheduledFor] = useState("");
  const [notes, setNotes] = useState("");
  const [outcome, setOutcome] = useState("");
  const [nextAction, setNextAction] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!deliverable) return;
    setStatus(deliverable.status);
    setScheduledFor(deliverable.scheduledFor ? deliverable.scheduledFor.slice(0, 10) : "");
    setNotes(deliverable.notes ?? "");
    setOutcome(deliverable.outcome ?? "");
    setNextAction(deliverable.isNextAction);
  }, [deliverable]);

  if (!deliverable) return null;
  const resolved = isResolvedStatus(status);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!deliverable) return;
    const changes: Parameters<typeof cfUpdateEnrollmentDeliverable>[2] = {};
    if (status !== deliverable.status) changes.status = status;
    const date = scheduledFor || null;
    // A program-wide date is set in Programs › Deliverables, never per client.
    if (
      !deliverable.dateSetByProgram &&
      date !== (deliverable.scheduledFor ? deliverable.scheduledFor.slice(0, 10) : null)
    ) {
      changes.scheduledFor = date;
    }
    if (notes.trim() !== (deliverable.notes ?? "")) changes.notes = notes.trim() || null;
    if (outcome.trim() !== (deliverable.outcome ?? "")) changes.outcome = outcome.trim() || null;
    const wantsNextAction = nextAction && !resolved;
    if (!wantsNextAction && deliverable.isNextAction && !resolved) changes.isNextAction = false;

    setSaving(true);
    try {
      if (Object.keys(changes).length > 0) {
        await cfUpdateEnrollmentDeliverable(enrollmentId, deliverable.id, changes);
      }
      if (wantsNextAction && !deliverable.isNextAction) {
        await cfSetDeliverableNextAction(enrollmentId, deliverable.id);
      }
      toast.success(`${deliverable.titleSnapshot} saved.`);
      onSaved();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the deliverable.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">{deliverable.titleSnapshot}</DialogTitle>
          {deliverable.descriptionSnapshot && (
            <DialogDescription>{deliverable.descriptionSnapshot}</DialogDescription>
          )}
        </DialogHeader>
        <form id="deliverable-edit-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select
                value={status}
                onValueChange={(value) => setStatus(value as DeliverableStatus)}
              >
                <SelectTrigger aria-label="Status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DELIVERABLE_STATUSES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {DELIVERABLE_STATUS_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              {deliverable.dateSetByProgram ? (
                <>
                  <Label>Date</Label>
                  <p className="text-sm" aria-label="Program date">
                    {deliverable.scheduledFor
                      ? formatDeliverableDate(deliverable.scheduledFor, "long")
                      : "Not set yet"}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    Set for the whole program in Programs › Deliverables.
                  </p>
                </>
              ) : (
                <>
                  <Label htmlFor="deliverable-date">Date (optional)</Label>
                  <Input
                    id="deliverable-date"
                    type="date"
                    value={scheduledFor}
                    onChange={(event) => setScheduledFor(event.target.value)}
                  />
                </>
              )}
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deliverable-notes">Notes</Label>
            <Textarea
              id="deliverable-notes"
              rows={2}
              maxLength={4000}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deliverable-outcome">Outcome</Label>
            <Input
              id="deliverable-outcome"
              maxLength={4000}
              value={outcome}
              onChange={(event) => setOutcome(event.target.value)}
              placeholder="e.g. 4 opportunities shared"
            />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Checkbox
              checked={nextAction && !resolved}
              disabled={resolved}
              onCheckedChange={(value) => setNextAction(value === true)}
            />
            Set as next program action
            {resolved && (
              <span className="text-xs text-muted-foreground">(only for unfinished items)</span>
            )}
          </label>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="deliverable-edit-form" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
