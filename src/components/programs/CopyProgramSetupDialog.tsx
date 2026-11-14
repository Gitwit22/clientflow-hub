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
import { CopySetupPicker } from "@/components/programs/CopySetupPicker";
import { copyProgramSetup } from "@/lib/api";
import { newIdempotencyKey } from "@/lib/client-send";
import { defaultCopySource, SETUP_COPY_PARTS, type SetupCopyChoice } from "@/lib/setup-copy";
import type { Program } from "@/types";

/**
 * Finishes an inactive program by copying parts of another program's setup into it. What it already
 * has (its own questions, welcome email, same-named agreements and deliverables) is kept.
 */
export function CopyProgramSetupDialog({
  program,
  programs,
  open,
  onOpenChange,
  onCopied,
}: {
  program: Program;
  programs: Program[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCopied: () => void;
}) {
  const [choice, setChoice] = useState<SetupCopyChoice>({ sourceProgramId: "", parts: [] });
  const [copyKey, setCopyKey] = useState(newIdempotencyKey);
  const [copying, setCopying] = useState(false);

  useEffect(() => {
    if (!open) return;
    setChoice({
      sourceProgramId: defaultCopySource(programs, program.id),
      parts: SETUP_COPY_PARTS.map((item) => item.part),
    });
    setCopyKey(newIdempotencyKey());
    // `programs` only seeds the default choice when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, program.id]);

  async function copy() {
    if (!choice.sourceProgramId || choice.parts.length === 0) return;
    setCopying(true);
    try {
      const result = await copyProgramSetup(program.id, choice, copyKey);
      const done = result.parts.filter(
        (part) => part.outcome === "copy" || part.outcome === "replace",
      );
      toast.success(
        done.length
          ? `Copied: ${done.map((part) => part.label).join(", ")}. Review it before activating.`
          : "Nothing new to copy: this program already had those parts.",
      );
      onCopied();
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't copy the setup.");
      // A failed copy changed nothing; a new attempt is a new request.
      setCopyKey(newIdempotencyKey());
    } finally {
      setCopying(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !copying && onOpenChange(value)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">Copy setup into {program.name}</DialogTitle>
          <DialogDescription>
            Bring over parts of another program's setup. What this program already has is kept.
          </DialogDescription>
        </DialogHeader>
        <CopySetupPicker
          programs={programs}
          targetProgramId={program.id}
          value={choice}
          onChange={setChoice}
        />
        <DialogFooter>
          <Button variant="outline" disabled={copying} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={copying || !choice.sourceProgramId || choice.parts.length === 0}
            onClick={() => void copy()}
          >
            {copying ? "Copying…" : "Copy setup"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
