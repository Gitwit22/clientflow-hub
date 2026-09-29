import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";
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
import { AddClientDialog } from "@/components/dialogs/AddClientDialog";
import { PermanentDeleteClientDialog } from "@/components/dialogs/PermanentDeleteClientDialog";
import { SendFormDialog } from "@/components/dialogs/SendFormDialog";
import { useAppState } from "@/lib/store";
import { archiveClient, loadArchivedClients } from "@/lib/api";
import { lifecycleBucket } from "@/lib/client-lifecycle";
import { ClientProgramBadges } from "@/components/clients/ClientProgramBadges";
import { memberOptionLabel, useOrganizationMembers } from "@/hooks/use-organization-members";
import { type Client, type RelationshipType } from "@/types";

const LIFECYCLE_TABS = [
  { value: "all", label: "All" },
  { value: "onboarding", label: "Onboarding" },
  { value: "active", label: "Active" },
  { value: "archived", label: "Archived" },
] as const;

const RELATIONSHIP_OPTIONS: { value: RelationshipType | "all"; label: string }[] = [
  { value: "all", label: "All relationships" },
  { value: "prospect", label: "Prospect" },
  { value: "applicant", label: "Applicant" },
  { value: "client", label: "Client" },
  { value: "sponsor", label: "Sponsor" },
];

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
  const { authenticatedAdmin, clients, programs, contracts, enrollments, monitoring } =
    useAppState();
  const { members } = useOrganizationMembers();
  const [q, setQ] = useState("");
  const [program, setProgram] = useState("all");
  const [staff, setStaff] = useState("all");
  const [lifecycleView, setLifecycleView] =
    useState<(typeof LIFECYCLE_TABS)[number]["value"]>("all");
  const [relationship, setRelationship] = useState<RelationshipType | "all">("all");
  const [sendTo, setSendTo] = useState<Client | null>(null);
  const [deletingClient, setDeletingClient] = useState<Client | null>(null);
  const [addClientOpen, setAddClientOpen] = useState(false);
  const canDelete =
    authenticatedAdmin?.role === "org_admin" || authenticatedAdmin?.role === "super_admin";

  const programName = (id: string | null) =>
    programs.find((p) => p.id === id)?.name ?? "Unassigned";

  // Read-only, best-effort "what should staff do next" label — no new workflow logic.
  function nextActionFor(c: Client): string {
    if (!enrollments.some((enrollment) => enrollment.clientId === c.id)) return "Assign program";
    const clientContracts = contracts
      .filter((contract) => contract.clientId === c.id)
      .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    const latestContract = clientContracts[0];
    if (latestContract?.status === "DRAFT") return "Send contract";
    if (latestContract?.status === "SENT") return "Awaiting signature";
    const enrollmentIds = new Set(
      enrollments
        .filter((enrollment) => enrollment.clientId === c.id)
        .map((enrollment) => enrollment.id),
    );
    const dueMonitoring = monitoring
      .filter((item) => enrollmentIds.has(item.enrollmentId) && item.active && item.nextReviewAt)
      .sort((a, b) => Date.parse(a.nextReviewAt!) - Date.parse(b.nextReviewAt!))[0];
    if (dueMonitoring && new Date(dueMonitoring.nextReviewAt!) <= new Date()) {
      return `${dueMonitoring.name} check-in`;
    }
    if (c.nextFollowUpDate) return "Follow up";
    return "—";
  }

  // The startup load is the active caseload; the archive is fetched when its tab is opened.
  useEffect(() => {
    if (lifecycleView !== "archived") return;
    loadArchivedClients().catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : "Unable to load archived clients.");
    });
  }, [lifecycleView]);

  const rows = clients.filter((c) => {
    const clientEnrollments = enrollments.filter((enrollment) => enrollment.clientId === c.id);
    const bucket = lifecycleBucket(c, clientEnrollments);
    // "All" is the working caseload; archived clients live under the Archived tab.
    if (lifecycleView === "all" ? c.isArchived : bucket !== lifecycleView) return false;
    if (relationship !== "all" && c.relationshipType !== relationship) return false;
    if (
      program !== "all" &&
      !clientEnrollments.some((enrollment) => enrollment.programId === program)
    ) {
      return false;
    }
    if (staff !== "all" && c.assignedUserId !== staff) return false;
    const t = q.toLowerCase();
    return (
      !t ||
      c.businessName.toLowerCase().includes(t) ||
      c.primaryContactName.toLowerCase().includes(t) ||
      c.email.toLowerCase().includes(t)
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Clients"
        description="One master profile per client, across every program they touch."
        actions={
          <div className="flex items-center gap-2">
            <Button onClick={() => setAddClientOpen(true)}>Add client</Button>
          </div>
        }
      />

      <AddClientDialog open={addClientOpen} onOpenChange={setAddClientOpen} />

      <Card className="space-y-4 p-4 shadow-card">
        {/* Lifecycle filter tabs */}
        <div className="flex flex-wrap gap-1 border-b border-border pb-3">
          {LIFECYCLE_TABS.map((tab) => (
            <button
              key={tab.value}
              onClick={() => setLifecycleView(tab.value)}
              className={`rounded-md px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wide transition-colors ${
                lifecycleView === tab.value
                  ? "bg-ink text-ink-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div className="grid gap-3 lg:grid-cols-4">
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
          <Select
            value={relationship}
            onValueChange={(v) => setRelationship(v as RelationshipType | "all")}
          >
            <SelectTrigger>
              <SelectValue placeholder="Relationship" />
            </SelectTrigger>
            <SelectContent>
              {RELATIONSHIP_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Business / Profile</TableHead>
                <TableHead>Primary contact</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Programs</TableHead>
                <TableHead>Staff</TableHead>
                <TableHead>Last activity</TableHead>
                <TableHead>Next follow-up</TableHead>
                <TableHead>Next action</TableHead>
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
                    <ClientProgramBadges
                      enrollments={enrollments.filter((enrollment) => enrollment.clientId === c.id)}
                      programName={programName}
                    />
                  </TableCell>
                  <TableCell className="text-sm">{c.assignedStaff}</TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {new Date(c.updatedAt).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {c.nextFollowUpDate ? new Date(c.nextFollowUpDate).toLocaleDateString() : "—"}
                  </TableCell>
                  <TableCell className="text-sm">{nextActionFor(c)}</TableCell>
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
                    {canDelete ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="text-destructive hover:text-destructive"
                        onClick={() => setDeletingClient(c)}
                      >
                        <Trash2 className="size-4" />
                        Delete
                      </Button>
                    ) : null}
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
      <PermanentDeleteClientDialog
        client={deletingClient}
        onOpenChange={(open) => !open && setDeletingClient(null)}
      />
    </div>
  );
}
