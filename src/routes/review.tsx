import { useCallback, useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
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
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  acfApproveReview,
  acfDeclineReview,
  acfListClients,
  acfUpdateClientProgram,
  ApiError,
  type AutomatedClient,
} from "@/lib/apiClient";
import { useAppState } from "@/lib/store";

export const Route = createFileRoute("/review")({
  head: () => ({
    meta: [
      { title: "Pending Review — ClientFlow" },
      {
        name: "description",
        content: "Clients whose selected program requires staff approval before a contract is sent.",
      },
    ],
  }),
  component: ReviewQueuePage,
});

function ReviewQueuePage() {
  const { authenticatedAdmin } = useAppState();
  const organizationId = authenticatedAdmin?.organizationId;
  const staffSignerName =
    [authenticatedAdmin?.firstName, authenticatedAdmin?.lastName].filter(Boolean).join(" ") ||
    authenticatedAdmin?.email ||
    "";
  const [clients, setClients] = useState<AutomatedClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyClientId, setBusyClientId] = useState<string | null>(null);
  const [programEdits, setProgramEdits] = useState<Record<string, string>>({});
  const [signingClient, setSigningClient] = useState<AutomatedClient | null>(null);

  const refresh = useCallback(() => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    acfListClients(organizationId, "PENDING_STAFF_REVIEW")
      .then(setClients)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Unable to load pending review clients.");
      })
      .finally(() => setLoading(false));
  }, [organizationId]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function handleApprove(client: AutomatedClient) {
    setBusyClientId(client.id);
    try {
      await acfApproveReview(client.id, { staffSignerName, staffSignerId: authenticatedAdmin?.id });
      toast.success(`${client.businessName || client.contactName}: signed and sent for signature.`);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Unable to approve this client.");
    } finally {
      setBusyClientId(null);
      setSigningClient(null);
    }
  }

  async function handleDecline(client: AutomatedClient) {
    setBusyClientId(client.id);
    try {
      await acfDeclineReview(client.id);
      toast.success(`${client.businessName || client.contactName}: review declined.`);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Unable to decline this client.");
    } finally {
      setBusyClientId(null);
    }
  }

  async function handleCorrectProgram(client: AutomatedClient) {
    const programId = programEdits[client.id]?.trim();
    if (!programId) {
      toast.error("Enter the correct program ID first.");
      return;
    }
    setBusyClientId(client.id);
    try {
      await acfUpdateClientProgram(client.id, programId);
      toast.success(`${client.businessName || client.contactName}: program corrected.`);
      refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Unable to correct this client's program.");
    } finally {
      setBusyClientId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pending Review"
        description="Clients whose selected program requires staff approval before a contract is sent."
      />

      <Card className="overflow-x-auto p-4 shadow-card">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : clients.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Nothing is waiting on staff review right now.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Correct program</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">{client.businessName || client.contactName}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {client.contactName} · {client.email}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={client.status} />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Label htmlFor={`program-${client.id}`} className="sr-only">
                        Program ID
                      </Label>
                      <Input
                        id={`program-${client.id}`}
                        placeholder="program_id"
                        className="h-8 w-40"
                        value={programEdits[client.id] ?? ""}
                        onChange={(event) =>
                          setProgramEdits((current) => ({
                            ...current,
                            [client.id]: event.target.value,
                          }))
                        }
                        disabled={busyClientId === client.id}
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleCorrectProgram(client)}
                        disabled={busyClientId === client.id}
                      >
                        Apply
                      </Button>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-2">
                      <Button
                        size="sm"
                        onClick={() => setSigningClient(client)}
                        disabled={busyClientId === client.id}
                      >
                        Approve & send
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleDecline(client)}
                        disabled={busyClientId === client.id}
                      >
                        Decline
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <AlertDialog open={signingClient !== null} onOpenChange={(open) => !open && setSigningClient(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign and send this agreement?</AlertDialogTitle>
            <AlertDialogDescription>
              You are electronically signing this agreement for the organization as{" "}
              <strong>{staffSignerName || "your account"}</strong>. The client will then receive it
              to review and sign.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => signingClient && handleApprove(signingClient)}
              disabled={!staffSignerName}
            >
              Sign & send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
