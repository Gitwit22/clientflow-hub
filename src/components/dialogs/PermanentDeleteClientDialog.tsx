import { useState } from "react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { deleteClient } from "@/lib/api";
import type { Client } from "@/types";

const sameName = (typed: string, expected: string) =>
  typed.trim().replace(/\s+/g, " ").toLowerCase() ===
  expected.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Permanent deletion erases the client and everything recorded for them, payments included, so it
 * asks for the business name. Archiving is the alternative that keeps the financial history.
 */
export function PermanentDeleteClientDialog({
  client,
  onOpenChange,
  onDeleted,
}: {
  client: Client | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
}) {
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const confirmed = client ? sameName(typed, client.businessName) : false;

  const close = (open: boolean) => {
    if (open || deleting) return;
    setTyped("");
    onOpenChange(false);
  };

  async function confirmDelete() {
    if (!client || !confirmed) return;
    setDeleting(true);
    try {
      await deleteClient(client.id, typed);
      toast.success(`${client.businessName} was permanently deleted, including their payments.`);
      setTyped("");
      onOpenChange(false);
      onDeleted?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to delete client.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={client !== null} onOpenChange={close}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Permanently delete this client?</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-2">
              <p>
                {client?.businessName} and everything recorded for them will be erased: enrollments,
                forms, contracts, uploaded files, communications, reports, tasks, monitoring,
                activity, <strong>billing agreements and payments</strong>. Their payments will no
                longer appear in Payments or Reports. This cannot be undone.
              </p>
              <p>To keep their record and financial history, archive the client instead.</p>
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor="permanent-delete-confirmation">
            Type <span className="font-semibold">{client?.businessName}</span> to confirm
          </Label>
          <Input
            id="permanent-delete-confirmation"
            value={typed}
            autoComplete="off"
            onChange={(event) => setTyped(event.target.value)}
            disabled={deleting}
          />
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={!confirmed || deleting}
            onClick={(event) => {
              event.preventDefault();
              void confirmDelete();
            }}
          >
            {deleting ? "Deleting..." : "Delete permanently"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
