import { useEffect, useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cfPreviewSetupCopy, type SetupCopyPart, type SetupCopyPartResult } from "@/lib/apiClient";
import type { Program } from "@/types";
import { SETUP_COPY_PARTS, type SetupCopyChoice } from "@/lib/setup-copy";

const OUTCOME_WORD: Record<SetupCopyPartResult["outcome"], string> = {
  copy: "Copies",
  replace: "Replaces",
  skip: "Kept as is",
  nothing: "Nothing to copy",
};

/**
 * Choose a program to copy setup from and the parts to copy, with a preview of what each part will
 * do (computed by the server, so it matches what the copy then does). `targetProgramId` is the
 * program being finished, or null for a new program.
 */
export function CopySetupPicker({
  programs,
  targetProgramId,
  value,
  onChange,
}: {
  programs: Program[];
  targetProgramId: string | null;
  value: SetupCopyChoice;
  onChange: (value: SetupCopyChoice) => void;
}) {
  const sources = programs.filter((program) => program.id !== targetProgramId);
  const [preview, setPreview] = useState<SetupCopyPartResult[] | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);

  useEffect(() => {
    if (!value.sourceProgramId || value.parts.length === 0) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    cfPreviewSetupCopy(targetProgramId, value)
      .then((result) => {
        if (cancelled) return;
        setPreview(result.parts);
        setPreviewError(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(error instanceof Error ? error.message : "Couldn't preview the copy.");
      });
    return () => {
      cancelled = true;
    };
  }, [targetProgramId, value]);

  const toggle = (part: SetupCopyPart, checked: boolean) =>
    onChange({
      ...value,
      parts: SETUP_COPY_PARTS.map((item) => item.part).filter((candidate) =>
        candidate === part ? checked : value.parts.includes(candidate),
      ),
    });

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label>Copy setup from</Label>
        <Select
          value={value.sourceProgramId}
          onValueChange={(sourceProgramId) => onChange({ ...value, sourceProgramId })}
        >
          <SelectTrigger aria-label="Copy setup from">
            <SelectValue placeholder="Choose a program" />
          </SelectTrigger>
          <SelectContent>
            {sources.map((program) => (
              <SelectItem key={program.id} value={program.id}>
                {program.name}
                {program.isActive ? "" : " (inactive)"}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What to copy</legend>
        {SETUP_COPY_PARTS.map(({ part, label, hint }) => {
          const result = preview?.find((item) => item.part === part);
          const checked = value.parts.includes(part);
          return (
            <div key={part} className="flex items-start gap-2">
              <Checkbox
                id={`copy-part-${part}`}
                checked={checked}
                onCheckedChange={(next) => toggle(part, next === true)}
                className="mt-0.5"
              />
              <div className="min-w-0 text-sm">
                <Label htmlFor={`copy-part-${part}`} className="font-medium">
                  {label}
                </Label>
                <p className="text-xs text-muted-foreground">
                  {checked && result ? (
                    <>
                      <span className="font-medium">{OUTCOME_WORD[result.outcome]}:</span>{" "}
                      {result.detail}
                    </>
                  ) : (
                    hint
                  )}
                </p>
              </div>
            </div>
          );
        })}
      </fieldset>
      {previewError && (
        <p role="alert" className="text-sm text-destructive">
          {previewError}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        Only setup is copied, never clients or their history. Review and edit everything before
        activating the program.
      </p>
    </div>
  );
}
