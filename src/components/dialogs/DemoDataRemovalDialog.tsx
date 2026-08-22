import { useState } from "react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiError, cfRemoveDemo, type LiveModeTransitionResult } from "@/lib/apiClient";
import { hideMockData } from "@/lib/store";

const PERMANENT_CONFIRMATION = "REMOVE DEMO DATA";

type DemoRemovalMode = "session" | "permanent";

interface DemoDataRemovalDialogProps {
  mode: DemoRemovalMode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPermanentSuccess?: (result: LiveModeTransitionResult) => void | Promise<void>;
}

export function DemoDataRemovalDialog({
  mode,
  open,
  onOpenChange,
  onPermanentSuccess,
}: DemoDataRemovalDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const permanent = mode === "permanent";

  function resetAndClose() {
    setCurrentPassword("");
    setConfirmation("");
    onOpenChange(false);
  }

  async function handleConfirm() {
    if (!permanent) {
      hideMockData(false);
      resetAndClose();
      toast.success("Demo data hidden until you log out.");
      return;
    }

    setSubmitting(true);
    try {
      const result = await cfRemoveDemo({
        currentPassword,
        confirmation,
      });
      hideMockData(true);
      await onPermanentSuccess?.(result);
      resetAndClose();
      toast.success("Demo data permanently removed from this account.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to remove demo data.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={submitting ? undefined : onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {permanent ? "Remove demo data permanently?" : "Hide demo data for this session?"}
          </DialogTitle>
          <DialogDescription>
            {permanent
              ? "Sample clients and their operational records will be permanently deleted for this organization. Programs, form templates, and real records will remain. This cannot be undone."
              : "Sample clients and their operational records will be hidden until you log out. Programs and form templates will remain, and no account data will be deleted."}
          </DialogDescription>
        </DialogHeader>

        {permanent && (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="remove-demo-password">Current password</Label>
              <Input
                id="remove-demo-password"
                type="password"
                autoComplete="current-password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="remove-demo-confirmation">Type {PERMANENT_CONFIRMATION}</Label>
              <Input
                id="remove-demo-confirmation"
                value={confirmation}
                onChange={(event) => setConfirmation(event.target.value)}
              />
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={
              submitting ||
              (permanent && (!currentPassword || confirmation !== PERMANENT_CONFIRMATION))
            }
          >
            {submitting ? "Removing..." : permanent ? "Remove permanently" : "Hide for session"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
