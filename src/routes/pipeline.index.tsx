import { useCallback, useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Card } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { acfListClients, ApiError, type AutomatedClient, type AutomatedClientStatus } from "@/lib/apiClient";
import { useAppState } from "@/lib/store";

export const Route = createFileRoute("/pipeline/")({
  validateSearch: (search: Record<string, unknown>) => ({
    status: typeof search.status === "string" ? (search.status as AutomatedClientStatus) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Pipeline — ClientFlow" },
      {
        name: "description",
        content: "Every client moving through the automated intake, program and contract workflow.",
      },
    ],
  }),
  component: PipelinePage,
});

const STATUS_OPTIONS: { value: AutomatedClientStatus | "all"; label: string }[] = [
  { value: "all", label: "All statuses" },
  { value: "INTAKE_SENT", label: "Intake Sent" },
  { value: "INTAKE_SUBMITTED", label: "Intake Submitted" },
  { value: "PROGRAM_SELECTED", label: "Program Selected" },
  { value: "PENDING_STAFF_REVIEW", label: "Pending Staff Review" },
  { value: "REVIEW_DECLINED", label: "Review Declined" },
  { value: "CONTRACT_SENT", label: "Contract Sent" },
  { value: "CONTRACT_OPENED", label: "Contract Opened" },
  { value: "ONBOARDING", label: "Onboarding" },
];

function PipelinePage() {
  const { authenticatedAdmin } = useAppState();
  const organizationId = authenticatedAdmin?.organizationId;
  const { status: initialStatus } = Route.useSearch();
  const [status, setStatus] = useState<AutomatedClientStatus | "all">(initialStatus ?? "all");
  const [clients, setClients] = useState<AutomatedClient[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    if (!organizationId) return;
    setLoading(true);
    setError(null);
    acfListClients(organizationId, status === "all" ? undefined : status)
      .then(setClients)
      .catch((err: unknown) => {
        setError(err instanceof ApiError ? err.message : "Unable to load clients.");
      })
      .finally(() => setLoading(false));
  }, [organizationId, status]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Pipeline"
        description="Every client moving through the automated intake, program and contract workflow."
        actions={
          <Select value={status} onValueChange={(value) => setStatus(value as AutomatedClientStatus | "all")}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />

      <Card className="overflow-x-auto p-4 shadow-card">
        {loading ? (
          <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
        ) : error ? (
          <p className="py-8 text-center text-sm text-destructive">{error}</p>
        ) : clients.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">No clients match this filter.</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Client</TableHead>
                <TableHead>Contact</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {clients.map((client) => (
                <TableRow key={client.id}>
                  <TableCell className="font-medium">
                    <Link
                      to="/pipeline/$id"
                      params={{ id: client.id }}
                      className="hover:text-primary"
                    >
                      {client.businessName || client.contactName}
                    </Link>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {client.contactName} · {client.email}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={client.status} />
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {new Date(client.createdAt).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}
