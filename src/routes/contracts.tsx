import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAppState } from "@/lib/store";
import { generateContract } from "@/lib/api";

export const Route = createFileRoute("/contracts")({
  head: () => ({
    meta: [
      { title: "Contracts — ClientFlow" },
      {
        name: "description",
        content: "Generate and track agreements built from intake and terms data.",
      },
      { property: "og:title", content: "Contracts — ClientFlow" },
      {
        property: "og:description",
        content: "Generate and track agreements built from intake and terms data.",
      },
    ],
  }),
  component: ContractsPage,
});

function ContractsPage() {
  const { contracts, clients, programs, terms } = useAppState();
  const [preview, setPreview] = useState<string | null>(null);
  const [genFor, setGenFor] = useState("");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contracts"
        description="Draft agreements merge client intake, program and terms data. Placeholder language only — not final legal text."
        actions={
          <div className="flex items-center gap-2">
            <Select value={genFor} onValueChange={setGenFor}>
              <SelectTrigger className="w-56">
                <SelectValue placeholder="Select client" />
              </SelectTrigger>
              <SelectContent>
                {clients
                  .filter((c) => !c.isArchived)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.businessName}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              disabled={!genFor}
              onClick={async () => {
                const t = terms.find((x) => x.clientId === genFor);
                const c = await generateContract(genFor, t?.id);
                setPreview(c.content);
                toast.success("Draft contract generated");
              }}
            >
              Generate contract
            </Button>
          </div>
        }
      />

      <Card className="overflow-x-auto p-4 shadow-card">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Client</TableHead>
              <TableHead>Program</TableHead>
              <TableHead>Contract type</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Created</TableHead>
              <TableHead>Sent</TableHead>
              <TableHead>Signed</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {contracts.map((c) => (
              <TableRow key={c.id}>
                <TableCell className="font-medium">
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: c.clientId }}
                    className="hover:text-primary"
                  >
                    {clients.find((x) => x.id === c.clientId)?.businessName}
                  </Link>
                </TableCell>
                <TableCell className="text-sm">
                  {programs.find((p) => p.id === c.programId)?.name ?? "—"}
                </TableCell>
                <TableCell className="text-sm">{c.contractType}</TableCell>
                <TableCell>
                  <StatusBadge status={c.status} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(c.createdAt).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {c.sentAt ? new Date(c.sentAt).toLocaleDateString() : "—"}
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {c.signedAt ? new Date(c.signedAt).toLocaleDateString() : "—"}
                </TableCell>
                <TableCell className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setPreview(c.content)}>
                    Preview
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>

      <Dialog open={!!preview} onOpenChange={(v) => !v && setPreview(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="font-display">Contract preview (draft)</DialogTitle>
          </DialogHeader>
          <pre className="font-sans text-sm whitespace-pre-wrap text-muted-foreground">
            {preview}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
}
