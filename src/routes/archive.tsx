import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAppState } from "@/lib/store";
import { restoreClient } from "@/lib/api";

export const Route = createFileRoute("/archive")({
  head: () => ({
    meta: [
      { title: "Archive — ClientFlow" },
      {
        name: "description",
        content: "Inactive, declined, completed and closed clients with final report access.",
      },
      { property: "og:title", content: "Archive — ClientFlow" },
      {
        property: "og:description",
        content: "Inactive, declined, completed and closed clients with final report access.",
      },
    ],
  }),
  component: ArchivePage,
});

function ArchivePage() {
  const { clients, programs, finalReports } = useAppState();
  const rows = clients.filter((c) => c.isArchived);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Archive"
        description="Clients are archived, never deleted — records stay available for audit and restore."
      />
      <Card className="overflow-x-auto p-4 shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Program</TableHead>
              <TableHead>Final status</TableHead>
              <TableHead>Archive reason</TableHead>
              <TableHead>Date archived</TableHead>
              <TableHead>Final report</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((c) => {
              const hasReport = finalReports.some((f) => f.clientId === c.id);
              return (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">{c.businessName}</TableCell>
                  <TableCell className="text-sm">
                    {programs.find((p) => p.id === c.programId)?.name ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm">{c.finalStatus ?? "—"}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.archiveReason ?? "—"}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.archivedAt ? new Date(c.archivedAt).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{hasReport ? "Available" : "Not filed"}</TableCell>
                  <TableCell className="space-x-1 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" asChild>
                      <Link to="/clients/$clientId" params={{ clientId: c.id }}>
                        View
                      </Link>
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        restoreClient(c.id);
                        toast.success("Client restored to active");
                      }}
                    >
                      Restore
                    </Button>
                    <Button size="sm" variant="ghost" disabled={!hasReport}>
                      Download report
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
        {rows.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            No archived clients yet.
          </p>
        ) : null}
      </Card>
    </div>
  );
}
