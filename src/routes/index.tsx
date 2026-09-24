import { createFileRoute, Link } from "@tanstack/react-router";
import { FilePlus2, FileSignature, Send, UserPlus } from "lucide-react";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { acfListClients, type AutomatedClientStatus } from "@/lib/apiClient";
import { useAppState } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Dashboard — ClientFlow" },
      {
        name: "description",
        content:
          "Daily operations dashboard: new intakes, reviews, forms sent, monitoring due and contracts pending.",
      },
      { property: "og:title", content: "Dashboard — ClientFlow" },
      {
        property: "og:description",
        content: "Track every client from intake to archive in one workflow dashboard.",
      },
    ],
  }),
  component: Dashboard,
});

function activityColor(action: string): string {
  const a = action.toLowerCase();
  if (a.includes("monitor") || a.includes("schedule")) return "#B8863A";
  if (a.includes("intake") || a.includes("received")) return "#2F6F62";
  if (a.includes("contract") || a.includes("terms") || a.includes("form") || a.includes("sent"))
    return "#6C5A8C";
  if (a.includes("status") || a.includes("review") || a.includes("changed")) return "#BE5138";
  if (a.includes("note") || a.includes("complete") || a.includes("confirmed")) return "#3F7A4C";
  return "#2F6F62";
}

function clientStatusColor(status: string): string {
  if (status === "New Intake") return "#2F6F62";
  if (["Needs Review", "More Information Needed"].includes(status)) return "#BE5138";
  if (["Contract Pending", "Terms Proposed"].includes(status)) return "#6C5A8C";
  if (["Final Report Needed", "Monitoring"].includes(status)) return "#B8863A";
  if (["Active", "Completed"].includes(status)) return "#3F7A4C";
  if (status === "CONTRACT_SENT") return "#6C5A8C";
  if (status === "ONBOARDING") return "#3F7A4C";
  if (status === "PENDING_STAFF_REVIEW") return "#BE5138";
  return "#7A7A72";
}

function Dashboard() {
  const { clients, formAssignments, monitoring, contracts, activity, programs, authenticatedAdmin } =
    useAppState();
  const today = new Date();
  const todayLabel = today.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const [automatedCounts, setAutomatedCounts] = useState<Record<AutomatedClientStatus, number> | null>(
    null,
  );

  useEffect(() => {
    const organizationId = authenticatedAdmin?.organizationId;
    if (!organizationId) return;
    acfListClients(organizationId)
      .then((automatedClients) => {
        const counts = automatedClients.reduce(
          (acc, client) => {
            acc[client.status as AutomatedClientStatus] =
              (acc[client.status as AutomatedClientStatus] ?? 0) + 1;
            return acc;
          },
          {} as Record<AutomatedClientStatus, number>,
        );
        setAutomatedCounts(counts);
      })
      .catch(() => setAutomatedCounts(null));
  }, [authenticatedAdmin?.organizationId]);

  const automatedStats: { label: string; status: AutomatedClientStatus; color: string }[] = [
    { label: "Intake Sent", status: "INTAKE_SENT", color: "#2F6F62" },
    { label: "Program Selected", status: "PROGRAM_SELECTED", color: "#6C5A8C" },
    { label: "Pending Review", status: "PENDING_STAFF_REVIEW", color: "#BE5138" },
    { label: "Contract Sent", status: "CONTRACT_SENT", color: "#6C5A8C" },
    { label: "Onboarding", status: "ONBOARDING", color: "#3F7A4C" },
  ];

  const stats = [
    {
      label: "New Intakes",
      tag: "Intake",
      color: "#2F6F62",
      value: clients.filter((c) => c.status === "New Intake").length,
    },
    {
      label: "Needs Review",
      tag: "Review",
      color: "#BE5138",
      value: clients.filter((c) => c.status === "Needs Review").length,
    },
    {
      label: "Forms Sent",
      tag: "Forms",
      color: "#6C5A8C",
      value: formAssignments.filter((f) =>
        ["sent", "delivered", "opened", "in_progress"].includes(f.status),
      ).length,
    },
    {
      label: "Active Clients",
      tag: "Clients",
      color: "#3F7A4C",
      value: clients.filter((c) => ["Active", "Monitoring"].includes(c.status)).length,
    },
    {
      label: "Monitoring Due",
      tag: "Ops",
      color: "#B8863A",
      value: monitoring.filter((m) => m.status === "Due" || m.status === "Overdue").length,
    },
    {
      label: "Contracts Pending",
      tag: "Legal",
      color: "#6C5A8C",
      value: contracts.filter((c) => ["DRAFT", "SENT", "OPENED"].includes(c.status))
        .length,
    },
    {
      label: "Completed This Month",
      tag: "Done",
      color: "#3F7A4C",
      value: clients.filter((c) => c.status === "Completed").length,
    },
    {
      label: "Archived Clients",
      tag: "Archive",
      color: "#7A7A72",
      value: clients.filter((c) => c.isArchived).length,
    },
  ];

  const followUps = clients
    .filter((c) => !c.isArchived && c.nextFollowUpDate)
    .sort((a, b) => (a.nextFollowUpDate! < b.nextFollowUpDate! ? -1 : 1))
    .slice(0, 5);

  const attention = clients.filter(
    (c) =>
      !c.isArchived &&
      ([
        "Needs Review",
        "More Information Needed",
        "Final Report Needed",
        "Contract Pending",
      ].includes(c.status) ||
        (c.nextFollowUpDate && new Date(c.nextFollowUpDate) < today)),
  );

  const programName = (id: string | null) =>
    programs.find((p) => p.id === id)?.name ?? "Unassigned";

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={`Today · ${todayLabel}`}
        title="Dashboard"
        description="Everything moving through intake, programs, monitoring and contracts today."
        actions={
          <>
            <Button asChild>
              <Link to="/intake">
                <UserPlus className="size-4" />
                Add client
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/intake">
                <FilePlus2 className="size-4" />
                Create intake
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/clients">
                <Send className="size-4" />
                Send form
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/contracts">
                <FileSignature className="size-4" />
                Create contract
              </Link>
            </Button>
          </>
        }
      />

      {/* Stat ledger */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg border border-border bg-card p-4"
            style={{ borderLeftWidth: "3px", borderLeftColor: s.color }}
          >
            <div className="mb-2.5 flex items-center justify-between">
              <span className="text-xs text-muted-foreground">{s.label}</span>
              <span
                className="font-mono text-[9.5px] uppercase tracking-wide"
                style={{ color: s.color }}
              >
                {s.tag}
              </span>
            </div>
            <p className="font-display text-[30px] font-semibold leading-none text-foreground">
              {s.value}
            </p>
          </div>
        ))}
      </div>

      {/* Automated intake → contract workflow */}
      {automatedCounts && (
        <div>
          <p className="mb-2.5 font-mono text-[10.5px] uppercase tracking-widest text-muted-foreground">
            Automated intake workflow
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            {automatedStats.map((s) => (
              <Link
                key={s.status}
                to="/pipeline"
                search={{ status: s.status }}
                className="rounded-lg border border-border bg-card p-4 transition-colors hover:border-primary/40"
                style={{ borderLeftWidth: "3px", borderLeftColor: s.color }}
              >
                <span className="text-xs text-muted-foreground">{s.label}</span>
                <p className="mt-2.5 font-display text-[30px] font-semibold leading-none text-foreground">
                  {automatedCounts[s.status] ?? 0}
                </p>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Panels row */}
      <div className="grid gap-4 lg:grid-cols-[1.55fr_1fr]">
        {/* Activity ledger */}
        <Card className="overflow-hidden">
          <div className="flex items-baseline justify-between border-b border-border px-5 py-4">
            <h2 className="font-display text-[17px] font-semibold text-foreground">
              Recent activity
            </h2>
            <span className="font-mono text-[11px] text-muted-foreground">Last 5 days</span>
          </div>
          <div>
            {activity.slice(0, 6).map((a) => (
              <div
                key={a.id}
                className="relative grid grid-cols-[72px_1fr] gap-4 border-b border-border px-5 py-3.5 last:border-0"
              >
                <span
                  className="absolute rounded-full"
                  style={{
                    left: 0,
                    top: "14px",
                    bottom: "14px",
                    width: "2px",
                    background: activityColor(a.action),
                  }}
                />
                <p className="pt-0.5 font-mono text-[11px] text-muted-foreground">
                  {new Date(a.timestamp).toLocaleDateString("en-US", {
                    month: "numeric",
                    day: "numeric",
                  })}
                </p>
                <div>
                  <p className="text-[13.5px] font-semibold text-foreground">{a.action}</p>
                  <p className="leading-relaxed text-[12.5px] text-muted-foreground">
                    {a.description}
                  </p>
                  <p className="mt-1 font-mono text-[10.5px] text-muted-foreground/70">{a.user}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>

        {/* Follow-ups */}
        <Card className="overflow-hidden">
          <div className="flex items-baseline justify-between border-b border-border px-5 py-4">
            <h2 className="font-display text-[17px] font-semibold text-foreground">
              Upcoming follow-ups
            </h2>
            <span className="font-mono text-[11px] text-muted-foreground">{followUps.length}</span>
          </div>
          <div>
            {followUps.map((c) => (
              <Link
                key={c.id}
                to="/clients/$clientId"
                params={{ clientId: c.id }}
                className="group flex items-start justify-between gap-3 border-b border-border px-5 py-3 last:border-0"
              >
                <div>
                  <p className="text-[13.5px] font-semibold text-foreground transition-colors group-hover:text-primary">
                    {c.businessName}
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{programName(c.programId)}</p>
                </div>
                <p className="whitespace-nowrap pt-0.5 font-mono text-[11px] text-primary">
                  {new Date(c.nextFollowUpDate!).toLocaleDateString("en-US", {
                    month: "numeric",
                    day: "numeric",
                  })}
                </p>
              </Link>
            ))}
          </div>
        </Card>
      </div>

      {/* Clients needing attention */}
      <div>
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className="font-display text-[19px] font-semibold text-foreground">
            Clients needing attention
          </h2>
          <span className="font-mono text-[11.5px] text-muted-foreground">
            {attention.length} flagged
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {attention.map((c) => (
            <Link
              key={c.id}
              to="/clients/$clientId"
              params={{ clientId: c.id }}
              className="block rounded-[7px] border border-border bg-card p-4 transition-shadow hover:shadow-elevated"
              style={{ borderTopWidth: "3px", borderTopColor: clientStatusColor(c.status) }}
            >
              <div className="mb-2 flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-foreground">{c.businessName}</p>
                <StatusBadge status={c.status} />
              </div>
              <p className="font-mono text-[10.5px] text-muted-foreground/70">
                {programName(c.programId)}
                {c.assignedStaff ? ` · ${c.assignedStaff}` : ""}
              </p>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
