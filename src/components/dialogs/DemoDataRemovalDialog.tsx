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
import { retryBootstrap } from "@/lib/store";

const PERMANENT_CONFIRMATION = "REMOVE DEMO DATA";

interface DemoDataRemovalDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPermanentSuccess?: (result: LiveModeTransitionResult) => void | Promise<void>;
}

export function DemoDataRemovalDialog({
  open,
  onOpenChange,
  onPermanentSuccess,
}: DemoDataRemovalDialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function resetAndClose() {
    setCurrentPassword("");
    setConfirmation("");
    onOpenChange(false);
  }

  async function handleConfirm() {
    setSubmitting(true);
    try {
      const result = await cfRemoveDemo({
        currentPassword,
        confirmation,
      });
      await onPermanentSuccess?.(result);
      retryBootstrap();
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
          <DialogTitle>Remove demo data permanently?</DialogTitle>
          <DialogDescription>
            Sample clients and their operational records will be permanently deleted for this organization. Programs, form templates, and real records will remain. This cannot be undone.
          </DialogDescription>
        </DialogHeader>

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

        <DialogFooter>
          <Button variant="outline" onClick={resetAndClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={
              submitting ||
              !currentPassword || confirmation !== PERMANENT_CONFIRMATION
            }
          >
            {submitting ? "Removing..." : "Remove permanently"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
