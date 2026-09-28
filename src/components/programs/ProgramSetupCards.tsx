import { useEffect, useState } from "react";
import { ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { TagListEditor } from "@/components/TagListEditor";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { updateProgram } from "@/lib/api";
import {
  JOURNEY_STAGES,
  journeyToProgramFields,
  programJourney,
  type JourneyStageId,
} from "@/lib/program-journey";
import { cn } from "@/lib/utils";
import type { Program } from "@/types";

const sameList = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((item, index) => item === b[index]);

export function ProgramJourneyCard({
  program,
  onSaved,
}: {
  program: Program;
  onSaved: () => void;
}) {
  const saved = programJourney(program);
  const [stages, setStages] = useState<JourneyStageId[]>(saved);
  const [saving, setSaving] = useState(false);
  const savedKey = saved.join(",");

  useEffect(() => {
    setStages(savedKey.split(",") as JourneyStageId[]);
  }, [program.id, savedKey]);

  function toggle(id: JourneyStageId) {
    setStages((current) =>
      JOURNEY_STAGES.filter((stage) =>
        stage.id === id ? !current.includes(id) : current.includes(stage.id),
      ).map((stage) => stage.id),
    );
  }

  async function save() {
    setSaving(true);
    try {
      await updateProgram(program.id, journeyToProgramFields(stages));
      toast.success("Client journey saved.");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save the client journey.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="shadow-card lg:col-span-2">
      <CardHeader>
        <CardTitle className="font-display text-base">Client journey</CardTitle>
        <p className="text-sm text-muted-foreground">
          The stages a client moves through in this program. Detailed statuses are handled for you.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-1.5">
          {JOURNEY_STAGES.map((stage, index) => {
            const on = stages.includes(stage.id);
            return (
              <div key={stage.id} className="flex items-center gap-1.5">
                {index > 0 && <ArrowRight className="size-3.5 text-muted-foreground" />}
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={stage.required || saving}
                  onClick={() => toggle(stage.id)}
                  title={stage.required ? "Every program includes this stage" : undefined}
                  className={cn(
                    "rounded-full border px-3 py-1 text-sm font-medium transition-colors",
                    on
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-dashed border-border text-muted-foreground line-through hover:bg-muted",
                    stage.required && "cursor-default",
                  )}
                >
                  {stage.label}
                </button>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-muted-foreground">
          Click Review, Contract or Monitoring to skip or include them. Intake, Active and Completed
          are always part of the journey.
        </p>
        <Button size="sm" onClick={() => void save()} disabled={saving || sameList(stages, saved)}>
          {saving ? "Saving..." : "Save journey"}
        </Button>
      </CardContent>
    </Card>
  );
}

export function ProgramDocumentsCard({
  program,
  onSaved,
}: {
  program: Program;
  onSaved: () => void;
}) {
  const saved = program.requiredDocuments ?? [];
  const [documents, setDocuments] = useState<string[]>(saved);
  const [saving, setSaving] = useState(false);
  const savedKey = JSON.stringify(saved);

  useEffect(() => {
    setDocuments(JSON.parse(savedKey) as string[]);
  }, [program.id, savedKey]);

  async function save() {
    setSaving(true);
    try {
      await updateProgram(program.id, { requiredDocuments: documents });
      toast.success("Required documents saved.");
      onSaved();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to save required documents.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="shadow-card lg:col-span-2">
      <CardHeader>
        <CardTitle className="font-display text-base">Required documents</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <TagListEditor
          label="Documents clients must provide"
          items={documents}
          onChange={setDocuments}
          placeholder="e.g. Signed agreement"
        />
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={saving || sameList(documents, saved)}
        >
          {saving ? "Saving..." : "Save documents"}
        </Button>
      </CardContent>
    </Card>
  );
}
