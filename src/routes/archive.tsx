import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useAppState } from "@/lib/store";
import { deleteClient, restoreClient } from "@/lib/api";
import type { Client } from "@/types";

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
  const { authenticatedAdmin, clients, programs, finalReports } = useAppState();
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const canDelete = authenticatedAdmin?.role === "org_admin"
    || authenticatedAdmin?.role === "super_admin";
  const rows = clients.filter((c) => c.isArchived);
  return (
    <div className="space-y-6">
      <PageHeader
        title="Archive"
        description="Archived clients remain available for audit and restore unless an administrator permanently deletes them."
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
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {c.archiveReason ?? "—"}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
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
                    {canDelete ? (
                      <Button
                        size="icon"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        title={`Permanently delete ${c.businessName}`}
                        aria-label={`Permanently delete ${c.businessName}`}
                        onClick={() => setDeletingClient(c)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    ) : null}
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
      <AlertDialog
        open={deletingClient !== null}
        onOpenChange={(open) => !open && !isDeleting && setDeletingClient(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Permanently delete this client?</AlertDialogTitle>
            <AlertDialogDescription>
              {deletingClient?.businessName} and all associated enrollments, forms, uploaded files,
              communications, reports, tasks, monitoring, and activity will be permanently deleted.
              This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={isDeleting}
              onClick={(event) => {
                event.preventDefault();
                if (!deletingClient) return;
                setIsDeleting(true);
                void deleteClient(deletingClient.id)
                  .then(() => {
                    toast.success("Client and associated information permanently deleted.");
                    setDeletingClient(null);
                  })
                  .catch((error: unknown) => {
                    toast.error(error instanceof Error ? error.message : "Unable to delete client.");
                  })
                  .finally(() => setIsDeleting(false));
              }}
            >
              {isDeleting ? "Deleting..." : "Delete permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
