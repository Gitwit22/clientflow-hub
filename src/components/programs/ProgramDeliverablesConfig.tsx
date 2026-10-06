import { useEffect, useState, type FormEvent } from "react";
import { ArrowDown, ArrowUp, Pencil, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
  cfListProgramDeliverableDates,
  cfListProgramDeliverables,
  cfReorderProgramDeliverables,
  cfSetProgramDeliverableDate,
  cfUpdateProgramDeliverable,
} from "@/lib/apiClient";
import {
  CADENCE_LABELS,
  formatDeliverableDate,
  type ProgramDeliverableDates,
  type ProgramDeliverableTemplate,
} from "@/lib/program-deliverables";

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

  const programWide =
    templates?.filter((template) => template.active && template.programWideDate) ?? [];

  return (
    <div className="space-y-4">
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
                      {template.active
                        ? `${CADENCE_LABELS[template.cadence]}${template.programWideDate ? " · Program date" : ""}`
                        : "Disabled"}
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
      {programWide.length > 0 && (
        <ProgramDatesCard
          programId={programId}
          refreshKey={programWide.map((template) => `${template.id}:${template.title}`).join("|")}
        />
      )}
    </div>
  );
}

/** "2026-10" for this month and the next two, with their names. */
function upcomingMonths(count = 3) {
  const now = new Date();
  return Array.from({ length: count }, (_, offset) => {
    const date = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    return {
      value: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`,
      label: date.toLocaleDateString(undefined, { month: "long", year: "numeric" }),
    };
  });
}

/**
 * Dates for deliverables that happen on the same day for every member (a grant day, an event).
 * Saving applies the date to every member's checklist for that month.
 */
function ProgramDatesCard({ programId, refreshKey }: { programId: string; refreshKey: string }) {
  const months = upcomingMonths();
  const [month, setMonth] = useState(months[0].value);
  const [dates, setDates] = useState<ProgramDeliverableDates | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDates(null);
    cfListProgramDeliverableDates(programId, month)
      .then((result) => {
        if (cancelled) return;
        setDates(result);
        setDrafts(
          Object.fromEntries(
            result.items.map((item) => [item.templateId, item.scheduledFor?.slice(0, 10) ?? ""]),
          ),
        );
      })
      .catch(
        (error: unknown) =>
          !cancelled && toast.error(errorMessage(error, "Unable to load program dates.")),
      );
    return () => {
      cancelled = true;
    };
  }, [programId, month, refreshKey]);

  async function save(templateId: string, value: string | null) {
    setSavingId(templateId);
    try {
      const result = await cfSetProgramDeliverableDate(programId, templateId, month, value);
      setDates(
        (current) =>
          current && {
            ...current,
            items: current.items.map((item) =>
              item.templateId === templateId
                ? { ...item, scheduledFor: result.scheduledFor }
                : item,
            ),
          },
      );
      setDrafts((current) => ({ ...current, [templateId]: value ?? "" }));
      toast.success(
        value
          ? `Date saved for ${result.label}. Updated ${result.clientsUpdated} member checklist${result.clientsUpdated === 1 ? "" : "s"}.`
          : `Date cleared for ${result.label}.`,
      );
    } catch (error) {
      toast.error(errorMessage(error, "Unable to save the date."));
    } finally {
      setSavingId(null);
    }
  }

  return (
    <Card className="shadow-card">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0">
        <div>
          <CardTitle className="font-display text-base">Program dates</CardTitle>
          <p className="text-xs text-muted-foreground">
            For deliverables that happen on the same day for everyone. The date is added to every
            member&apos;s checklist for that month.
          </p>
        </div>
        <div className="flex gap-1" aria-label="Month">
          {months.map((option) => (
            <Button
              key={option.value}
              size="sm"
              variant={option.value === month ? "default" : "ghost"}
              aria-pressed={option.value === month}
              onClick={() => setMonth(option.value)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent>
        {!dates ? (
          <p className="text-sm text-muted-foreground">Loading dates…</p>
        ) : (
          <ul className="divide-y divide-border">
            {dates.items.map((item) => {
              const draft = drafts[item.templateId] ?? "";
              const saved = item.scheduledFor?.slice(0, 10) ?? "";
              return (
                <li
                  key={item.templateId}
                  className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                  aria-label={`${item.title} date`}
                >
                  <div>
                    <p className="text-sm font-medium">{item.title}</p>
                    <p className="text-xs text-muted-foreground">
                      {item.scheduledFor
                        ? `${dates.label}: ${formatDeliverableDate(item.scheduledFor, "long")}`
                        : `No date set for ${dates.label}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      aria-label={`${item.title} date for ${dates.label}`}
                      className="h-8 w-auto"
                      value={draft}
                      min={`${month}-01`}
                      max={`${month}-31`}
                      onChange={(event) =>
                        setDrafts((current) => ({
                          ...current,
                          [item.templateId]: event.target.value,
                        }))
                      }
                    />
                    <Button
                      size="sm"
                      className="h-8"
                      disabled={savingId !== null || !draft || draft === saved}
                      onClick={() => void save(item.templateId, draft)}
                    >
                      {savingId === item.templateId ? "Saving…" : "Save"}
                    </Button>
                    {saved && (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8"
                        disabled={savingId !== null}
                        onClick={() => void save(item.templateId, null)}
                      >
                        Clear
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
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
  const [programWideDate, setProgramWideDate] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTitle(template?.title ?? "");
    setDescription(template?.description ?? "");
    setProgramWideDate(template?.programWideDate ?? false);
  }, [open, template]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!title.trim()) {
      toast.error("Give the deliverable a title.");
      return;
    }
    setSaving(true);
    try {
      const data = {
        title: title.trim(),
        description: description.trim() || null,
        programWideDate,
      };
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
          <label className="flex items-start gap-2 text-sm">
            <Checkbox
              className="mt-0.5"
              checked={programWideDate}
              onCheckedChange={(value) => setProgramWideDate(value === true)}
            />
            <span>
              Same date for everyone
              <span className="block text-xs text-muted-foreground">
                For an event all members attend. Set the date each month under Program dates; it
                can&apos;t be changed on individual clients. Leave unchecked to set dates per
                client.
              </span>
            </span>
          </label>
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
