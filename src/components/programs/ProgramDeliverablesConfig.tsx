import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  cfCreateProgramDeliverable,
  cfListProgramDeliverables,
  cfReorderProgramDeliverables,
  cfUpdateProgramDeliverable,
} from "@/lib/apiClient";
import { CADENCE_LABELS, type ProgramDeliverableTemplate } from "@/lib/program-deliverables";

const errorMessage = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/**
 * The program's deliverables: what every enrolled client is promised each month. Changes apply
 * to future months only; months already started keep what they had.
 */
export function ProgramDeliverablesConfig({ programId }: { programId: string }) {
  const [templates, setTemplates] = useState<ProgramDeliverableTemplate[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<ProgramDeliverableTemplate | "new" | null>(null);

  useEffect(() => {
    let cancelled = false;
    setTemplates(null);
    setLoadError(null);
    cfListProgramDeliverables(programId)
      .then((rows) => !cancelled && setTemplates(rows))
      .catch(
        (error: unknown) =>
          !cancelled && setLoadError(errorMessage(error, "Unable to load deliverables.")),
      );
    return () => {
      cancelled = true;
    };
  }, [programId]);

  async function move(index: number, offset: -1 | 1) {
    if (!templates) return;
    const next = [...templates];
    const [moved] = next.splice(index, 1);
    next.splice(index + offset, 0, moved);
    setBusy(true);
    try {
      setTemplates(
        await cfReorderProgramDeliverables(
          programId,
          next.map((row) => row.id),
        ),
      );
    } catch (error) {
      toast.error(errorMessage(error, "Unable to reorder deliverables."));
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(template: ProgramDeliverableTemplate) {
    setBusy(true);
    try {
      const updated = await cfUpdateProgramDeliverable(programId, template.id, {
        active: !template.active,
      });
      setTemplates((rows) => rows?.map((row) => (row.id === updated.id ? updated : row)) ?? null);
      toast.success(
        updated.active
          ? `${updated.title} enabled.`
          : `${updated.title} disabled for future months.`,
      );
    } catch (error) {
      toast.error(errorMessage(error, "Unable to update the deliverable."));
    } finally {
      setBusy(false);
    }
  }

  function saved(template: ProgramDeliverableTemplate) {
    setTemplates((rows) => {
      if (!rows) return [template];
      return rows.some((row) => row.id === template.id)
        ? rows.map((row) => (row.id === template.id ? template : row))
        : [...rows, template];
    });
    setEditing(null);
  }

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="font-display text-base">Program Deliverables</CardTitle>
          <p className="text-xs text-muted-foreground">
            What each enrolled client receives every month. Changes apply from the next month;
            months already started keep their list.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing("new")} disabled={busy || !templates}>
          <Plus className="mr-1.5 h-3.5 w-3.5" />
          Add deliverable
        </Button>
      </CardHeader>
      <CardContent>
        {loadError ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : !templates ? (
          <p className="text-sm text-muted-foreground">Loading deliverables…</p>
        ) : templates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No program deliverables configured.</p>
        ) : (
          <ul className="divide-y divide-border">
            {templates.map((template, index) => (
              <li
                key={template.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                aria-label={template.title}
              >
                <div className="min-w-0">
                  <p
                    className={
                      template.active
                        ? "text-sm font-medium"
                        : "text-sm text-muted-foreground line-through"
                    }
                  >
                    {template.title}
                  </p>
                  {template.description && (
                    <p className="text-xs text-muted-foreground">{template.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <span className="mr-2 font-mono text-[10px] uppercase text-muted-foreground">
                    {template.active ? CADENCE_LABELS[template.cadence] : "Disabled"}
                  </span>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={`Move ${template.title} up`}
                    disabled={busy || index === 0}
                    onClick={() => void move(index, -1)}
                  >
                    <ArrowUp className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    aria-label={`Move ${template.title} down`}
                    disabled={busy || index === templates.length - 1}
                    onClick={() => void move(index, 1)}
                  >
                    <ArrowDown className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 px-2"
                    aria-label={`Edit ${template.title}`}
                    disabled={busy}
                    onClick={() => setEditing(template)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 px-2 text-xs"
                    disabled={busy}
                    onClick={() => void toggleActive(template)}
                  >
                    {template.active ? "Disable" : "Enable"}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <DeliverableTemplateDialog
        programId={programId}
        template={editing === "new" ? null : editing}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSaved={saved}
      />
    </Card>
  );
}

function DeliverableTemplateDialog({
  programId,
  template,
  open,
  onOpenChange,
  onSaved,
}: {
  programId: string;
  template: ProgramDeliverableTemplate | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: (template: ProgramDeliverableTemplate) => void;
}) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(template?.title ?? "");
    setDescription(template?.description ?? "");
  }, [open, template]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      toast.error("Give the deliverable a title.");
      return;
    }
    setSaving(true);
    try {
      const data = { title: title.trim(), description: description.trim() || null };
      const result = template
        ? await cfUpdateProgramDeliverable(programId, template.id, data)
        : await cfCreateProgramDeliverable(programId, { ...data, cadence: "MONTHLY" });
      toast.success(template ? "Deliverable updated." : "Deliverable added.");
      onSaved(result);
    } catch (error) {
      toast.error(errorMessage(error, "Unable to save the deliverable."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            {template ? "Edit deliverable" : "Add deliverable"}
          </DialogTitle>
        </DialogHeader>
        <form id="deliverable-template-form" onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="deliverable-title">Title</Label>
            <Input
              id="deliverable-title"
              value={title}
              maxLength={200}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="e.g. Coaching Session"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="deliverable-description">Description (optional)</Label>
            <Textarea
              id="deliverable-description"
              rows={3}
              maxLength={2000}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Tracked monthly for every active client in this program.
          </p>
        </form>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="deliverable-template-form" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
