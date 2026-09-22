import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { acfGetClient, ApiError, type AutomatedClientDetail } from "@/lib/apiClient";

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
  const [client, setClient] = useState<AutomatedClientDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    acfGetClient(id)
      .then(setClient)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Unable to load this client.");
      })
      .finally(() => setLoading(false));
  }, [id]);

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
        </>
      )}
    </div>
  );
}
