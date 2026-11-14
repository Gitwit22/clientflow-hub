import { useEffect, useState } from "react";
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
import { deleteClient, getClientDeletionEligibility } from "@/lib/api";
import type { ClientDeletionEligibility } from "@/lib/apiClient";
import type { Client } from "@/types";

const sameName = (typed: string, expected: string) =>
  typed.trim().replace(/\s+/g, " ").toLowerCase() ===
  expected.trim().replace(/\s+/g, " ").toLowerCase();

/**
 * Permanent deletion erases the client and everything recorded for them, so it asks for the
 * business name. A client with any recorded payment can't be deleted at all, only archived, so the
 * dialog checks that first. The server enforces the same rule.
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
  // null while checking. If the check itself fails, the form stays usable: the server still refuses.
  const [eligibility, setEligibility] = useState<ClientDeletionEligibility | null>(null);
  const [checking, setChecking] = useState(false);
  const blocked = eligibility?.canDelete === false;
  const confirmed = client && !blocked ? sameName(typed, client.businessName) : false;

  const clientId = client?.id;
  useEffect(() => {
    if (!clientId) return;
    let cancelled = false;
    setEligibility(null);
    setChecking(true);
    getClientDeletionEligibility(clientId)
      .then((result) => {
        if (!cancelled) setEligibility(result);
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

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
      toast.success(`${client.businessName} was permanently deleted.`);
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
            {blocked ? (
              <div className="space-y-2" role="alert">
                <p>
                  <strong>{client?.businessName} can&apos;t be permanently deleted.</strong>{" "}
                  {eligibility?.message ??
                    "This client has recorded payments, so they can only be archived."}
                </p>
                <p>Archive the client instead to remove them from active lists.</p>
              </div>
            ) : (
              <div className="space-y-2">
                <p>
                  {client?.businessName} and everything recorded for them will be erased:
                  enrollments, forms, contracts, uploaded files, communications, reports, tasks,
                  monitoring and activity. This cannot be undone.
                </p>
                <p>
                  Clients with recorded payments can&apos;t be deleted. To keep a client&apos;s
                  record, archive the client instead.
                </p>
              </div>
            )}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {!blocked && (
          <div className="space-y-2">
            <Label htmlFor="permanent-delete-confirmation">
              Type <span className="font-semibold">{client?.businessName}</span> to confirm
            </Label>
            <Input
              id="permanent-delete-confirmation"
              value={typed}
              autoComplete="off"
              onChange={(event) => setTyped(event.target.value)}
              disabled={deleting || checking}
            />
          </div>
        )}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{blocked ? "Close" : "Cancel"}</AlertDialogCancel>
          {!blocked && (
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
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
