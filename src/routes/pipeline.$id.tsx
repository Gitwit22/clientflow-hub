import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
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
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  acfGenerateContract,
  acfGetClient,
  acfSendContract,
  ApiError,
  type AutomatedClientDetail,
} from "@/lib/apiClient";
import { useAppState } from "@/lib/store";

export const Route = createFileRoute("/pipeline/$id")({
  head: () => ({
    meta: [{ title: "Client — Pipeline — ClientFlow" }],
  }),
  component: PipelineClientDetailPage,
});

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="border-b border-border py-2 last:border-0">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm">{value || "—"}</dd>
    </div>
  );
}

function PipelineClientDetailPage() {
  const { id } = Route.useParams();
  const { authenticatedAdmin } = useAppState();
  const staffSignerName =
    [authenticatedAdmin?.firstName, authenticatedAdmin?.lastName].filter(Boolean).join(" ") ||
    authenticatedAdmin?.email ||
    "";
  const [client, setClient] = useState<AutomatedClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmingGenerate, setConfirmingGenerate] = useState(false);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    return acfGetClient(id)
      .then(setClient)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Unable to load this client.");
      })
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function handleGenerateAndSend() {
    setBusy(true);
    try {
      const generated = await acfGenerateContract(id, {
        staffSignerName,
        staffSignerId: authenticatedAdmin?.id,
      });
      await acfSendContract(id, generated.contract.id);
      toast.success("Contract signed and sent to the client.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Unable to generate or send this contract.");
    } finally {
      setBusy(false);
      setConfirmingGenerate(false);
    }
  }

  async function handleSendExisting(contractId: string) {
    setBusy(true);
    try {
      await acfSendContract(id, contractId);
      toast.success("Contract sent to the client.");
      await refresh();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Unable to send this contract.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/pipeline">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Pipeline
        </Link>
      </Button>

      {loading ? (
        <Card className="shadow-card">
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Loading client…
          </CardContent>
        </Card>
      ) : error || !client ? (
        <Card className="shadow-card">
          <CardContent className="py-10 text-center text-sm text-destructive">
            {error ?? "Client not found."}
          </CardContent>
        </Card>
      ) : (
        <>
          <PageHeader
            title={client.businessName || client.contactName}
            description={`${client.contactName} · ${client.email} · ${client.phone}`}
            actions={<StatusBadge status={client.status} />}
          />

          <div className="grid gap-4 lg:grid-cols-2">
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-base">Program & assignment</CardTitle>
              </CardHeader>
              <CardContent>
                <dl>
                  <Row label="Program" value={client.program?.name} />
                  <Row label="Assigned staff" value={client.assignedStaff} />
                  <Row label="Created" value={new Date(client.createdAt).toLocaleString()} />
                  <Row label="Last updated" value={new Date(client.updatedAt).toLocaleString()} />
                </dl>
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-base">Contract</CardTitle>
              </CardHeader>
              <CardContent>
                {client.contract ? (
                  <dl>
                    <Row label="Type" value={client.contract.contractType} />
                    <Row label="Status" value={client.contract.status} />
                    <Row
                      label="Sent"
                      value={client.contract.sentAt ? new Date(client.contract.sentAt).toLocaleString() : undefined}
                    />
                    <Row
                      label="Signed for organization by"
                      value={
                        client.contract.staffSignedByName && client.contract.staffSignedAt
                          ? `${client.contract.staffSignedByName} · ${new Date(client.contract.staffSignedAt).toLocaleString()}`
                          : undefined
                      }
                    />
                    <Row
                      label="Signed by client"
                      value={
                        client.contract.signedName
                          ? `${client.contract.signedName} (${client.contract.signedEmail ?? ""})`
                          : undefined
                      }
                    />
                    <Row
                      label="Completed"
                      value={
                        client.contract.completedAt
                          ? new Date(client.contract.completedAt).toLocaleString()
                          : undefined
                      }
                    />
                  </dl>
                ) : (
                  <p className="text-sm text-muted-foreground">No contract yet.</p>
                )}
                {client.contract?.documentUrl && (
                  <Button variant="outline" size="sm" className="mt-3" asChild>
                    <a href={client.contract.documentUrl} target="_blank" rel="noreferrer">
                      Download executed agreement
                    </a>
                  </Button>
                )}
                {!client.contract && client.program && client.status !== "PENDING_STAFF_REVIEW" && (
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => setConfirmingGenerate(true)}
                    disabled={busy}
                  >
                    Generate & send contract
                  </Button>
                )}
                {client.contract?.status === "DRAFT" && (
                  <Button
                    size="sm"
                    className="mt-3"
                    onClick={() => void handleSendExisting(client.contract!.id)}
                    disabled={busy}
                  >
                    Send draft contract
                  </Button>
                )}
              </CardContent>
            </Card>

            {client.monitoringTask && (
              <Card className="shadow-card lg:col-span-2">
                <CardHeader>
                  <CardTitle className="font-display text-base">First monitoring task</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid gap-x-6 sm:grid-cols-3">
                    <Row label="Type" value={client.monitoringTask.type} />
                    <Row label="Status" value={client.monitoringTask.status} />
                    <Row label="Due" value={new Date(client.monitoringTask.dueDate).toLocaleDateString()} />
                  </dl>
                </CardContent>
              </Card>
            )}
          </div>

          <AlertDialog open={confirmingGenerate} onOpenChange={(open) => !open && setConfirmingGenerate(false)}>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Sign and send this contract?</AlertDialogTitle>
                <AlertDialogDescription>
                  You are electronically signing this agreement for the organization as{" "}
                  <strong>{staffSignerName || "your account"}</strong>. The client will then receive it
                  to review and sign.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={() => void handleGenerateAndSend()} disabled={!staffSignerName || busy}>
                  Sign & send
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </>
      )}
    </div>
  );
}

