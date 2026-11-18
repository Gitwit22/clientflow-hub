import { useEffect, useState } from "react";
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
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cfMergeProgramDeliverable, type DeliverableMergeReport } from "@/lib/apiClient";
import type { ProgramDeliverableTemplate } from "@/lib/program-deliverables";

/**
 * Merges a deliverable into another one of the program when they are the same thing under two
 * names: its notes move to the other deliverable's item for the same month, its open items are
 * marked not applicable (history is kept), and it is turned off for future months.
 */
export function MergeDeliverableDialog({
  programId,
  from,
  templates,
  open,
  onOpenChange,
  onMerged,
}: {
  programId: string;
  from: ProgramDeliverableTemplate | null;
  templates: ProgramDeliverableTemplate[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged: () => void;
}) {
  const targets = templates.filter((template) => template.active && template.id !== from?.id);
  const [intoId, setIntoId] = useState("");
  const [preview, setPreview] = useState<DeliverableMergeReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [merging, setMerging] = useState(false);

  // With only one other deliverable, it is the one to merge into.
  const onlyTargetId = targets.length === 1 ? targets[0].id : "";
  useEffect(() => {
    if (!open) return;
    setIntoId(onlyTargetId);
    setPreview(null);
    setError(null);
  }, [open, from?.id, onlyTargetId]);

  useEffect(() => {
    if (!open || !from || !intoId) return;
    let cancelled = false;
    setPreview(null);
    cfMergeProgramDeliverable(programId, from.id, intoId, false)
      .then((report) => {
        if (cancelled) return;
        setPreview(report);
        setError(null);
      })
      .catch((failure: unknown) => {
        if (cancelled) return;
        setError(failure instanceof Error ? failure.message : "Couldn't preview the merge.");
      });
    return () => {
      cancelled = true;
    };
  }, [open, programId, from, intoId]);

  async function merge() {
    if (!from || !intoId) return;
    setMerging(true);
    try {
      const report = await cfMergeProgramDeliverable(programId, from.id, intoId, true);
      toast.success(
        `Merged “${report.from.title}” into “${report.into.title}”: ${report.notesMoved} note(s) moved, ${report.closed} open item(s) closed.`,
      );
      onMerged();
      onOpenChange(false);
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "Couldn't merge the deliverables.");
    } finally {
      setMerging(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !merging && onOpenChange(value)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Merge “{from?.title}”</DialogTitle>
          <DialogDescription>
            For two deliverables that are the same thing. Notes recorded on this one move to the
            other one&apos;s item for the same month, its open items are marked not applicable, and
            it is turned off for future months. Each item keeps its history.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <div className="space-y-1.5">
            <Label>Merge into</Label>
            <Select value={intoId} onValueChange={setIntoId}>
              <SelectTrigger aria-label="Merge into">
                <SelectValue placeholder="Choose the deliverable to keep" />
              </SelectTrigger>
              <SelectContent>
                {targets.map((template) => (
                  <SelectItem key={template.id} value={template.id}>
                    {template.title}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error && (
            <p role="alert" className="text-destructive">
              {error}
            </p>
          )}
          {preview && (
            <ul className="list-disc space-y-0.5 pl-5" aria-label="Merge preview">
              <li>
                {preview.items} item(s) of “{preview.from.title}” across clients and months
                {preview.alreadyMerged ? ` (${preview.alreadyMerged} already merged)` : ""}.
              </li>
              <li>
                {preview.notesMoved} with notes move to “{preview.into.title}” for the same month.
              </li>
              {preview.notesKeptInPlace > 0 && (
                <li>
                  {preview.notesKeptInPlace} with notes have no “{preview.into.title}” item that
                  month; their notes stay where they are.
                </li>
              )}
              <li>{preview.closed} open item(s) are marked not applicable.</li>
              <li>
                {preview.turnedOff
                  ? `“${preview.from.title}” is turned off for future months.`
                  : `“${preview.from.title}” is already off.`}
              </li>
            </ul>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={merging} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!preview || merging} onClick={() => void merge()}>
            {merging ? "Merging…" : "Merge"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
