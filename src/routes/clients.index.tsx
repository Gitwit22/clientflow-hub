import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { SendFormDialog } from "@/components/dialogs/SendFormDialog";
import { useAppState } from "@/lib/store";
import { archiveClient } from "@/lib/api";
import { memberOptionLabel, useOrganizationMembers } from "@/hooks/use-organization-members";
import { CLIENT_STATUSES, type Client } from "@/types";

export const Route = createFileRoute("/clients/")({
  head: () => ({
    meta: [
      { title: "Clients — ClientFlow" },
      {
        name: "description",
        content: "Searchable client list with program, status, staff and follow-up filters.",
      },
      { property: "og:title", content: "Clients — ClientFlow" },
      {
        property: "og:description",
        content: "Searchable client list with program, status, staff and follow-up filters.",
      },
    ],
  }),
  component: ClientsPage,
});

function ClientsPage() {
  const { clients, programs } = useAppState();
  const { members } = useOrganizationMembers();
  const [q, setQ] = useState("");
  const [program, setProgram] = useState("all");
  const [status, setStatus] = useState("all");
  const [staff, setStaff] = useState("all");
  const [scope, setScope] = useState("active");
  const [relationshipView, setRelationshipView] = useState("all");
  const [sendTo, setSendTo] = useState<Client | null>(null);

  const programName = (id: string | null) =>
    programs.find((p) => p.id === id)?.name ?? "Unassigned";

  const rows = clients.filter((c) => {
    // Relationship view filter
    if (relationshipView === "archived") {
      if (!c.isArchived) return false;
    } else if (relationshipView === "prospects") {
      if (c.isArchived || c.relationshipType !== "prospect") return false;
    } else if (relationshipView === "applicants") {
      if (c.isArchived || c.relationshipType !== "applicant") return false;
    } else if (relationshipView === "sponsors") {
      if (c.isArchived || c.relationshipType !== "sponsor") return false;
    } else if (relationshipView === "active-clients") {
      if (c.isArchived || (c.relationshipType && c.relationshipType !== "client")) return false;
    } else {
      // "all"
      if (scope === "active" && c.isArchived) return false;
      if (scope === "archived" && !c.isArchived) return false;
    }
    if (program !== "all" && c.programId !== program) return false;
    if (status !== "all" && c.status !== status) return false;
    if (staff !== "all" && c.assignedUserId !== staff) return false;
    const t = q.toLowerCase();
    return (
      !t ||
      c.businessName.toLowerCase().includes(t) ||
      c.primaryContactName.toLowerCase().includes(t) ||
      c.email.toLowerCase().includes(t)
    );
  });

  const RELATIONSHIP_TABS = [
    { value: "all", label: "All" },
    { value: "prospects", label: "Prospects" },
    { value: "applicants", label: "Applicants" },
    { value: "active-clients", label: "Active Clients" },
    { value: "sponsors", label: "Sponsors" },
    { value: "archived", label: "Archived" },
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="One master profile per client, across every program they touch."
        actions={
          <Button asChild>
            <Link to="/intake">New intake</Link>
          </Button>
        }
      />

      <Card className="space-y-4 p-4 shadow-card">
        {/* Relationship filter tabs */}
        <div className="flex flex-wrap gap-1 border-b border-border pb-3">
          {RELATIONSHIP_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setRelationshipView(tab.value)}
              className={`rounded-md px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wide transition-colors ${
                relationshipView === tab.value
                  ? "bg-ink text-ink-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-5">
          <Input placeholder="Search clients…" value={q} onChange={(e) => setQ(e.target.value)} />
          <Select value={program} onValueChange={setProgram}>
            <SelectTrigger>
              <SelectValue placeholder="Program" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All programs</SelectItem>
              {programs.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger>
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {CLIENT_STATUSES.map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={staff} onValueChange={setStaff}>
            <SelectTrigger>
              <SelectValue placeholder="Assigned staff" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All staff</SelectItem>
              {members.map((member) => (
                <SelectItem key={member.id} value={member.id}>
                  {memberOptionLabel(member)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {relationshipView === "all" && (
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active only</SelectItem>
                <SelectItem value="archived">Archived only</SelectItem>
                <SelectItem value="all">Active + archived</SelectItem>
              </SelectContent>
            </Select>
          )}
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business / Profile</TableHead>
                <TableHead>Primary contact</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead>Next follow-up</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((c) => (
                <TableRow key={c.id}>
                  <TableCell className="font-medium">
                    <Link
                      to="/clients/$clientId"
                      params={{ clientId: c.id }}
                      className="hover:text-primary"
                    >
                      {c.businessName}
                    </Link>
                    <div className="font-mono text-xs text-muted-foreground">{programName(c.programId)}</div>
                  </TableCell>
                  <TableCell>
                    <div className="text-sm">{c.primaryContactName}</div>
                    <div className="font-mono text-xs text-muted-foreground">{c.email}</div>
                  </TableCell>
                  <TableCell>
                    {c.relationshipType ? (
                      <StatusBadge status={c.relationshipType} />
                    ) : (
                      <span className="text-xs text-muted-foreground">client</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={c.status} />
                  </TableCell>
                  <TableCell className="text-sm">{c.assignedStaff}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {new Date(c.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {c.nextFollowUpDate ? new Date(c.nextFollowUpDate).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="space-x-1 text-right whitespace-nowrap">
                    <Button size="sm" variant="ghost" asChild>
                      <Link to="/clients/$clientId" params={{ clientId: c.id }}>
                        View
                      </Link>
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSendTo(c)}>
                      Send form
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        archiveClient(c.id);
                        toast.success("Client archived");
                      }}
                    >
                      Archive
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {rows.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              No profiles match these filters.
            </p>
          ) : null}
        </div>
      </Card>

      <SendFormDialog client={sendTo} open={!!sendTo} onOpenChange={(v) => !v && setSendTo(null)} />
    </div>
  );
}
