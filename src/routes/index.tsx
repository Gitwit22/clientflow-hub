import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowUpRight,
  CalendarClock,
  FilePlus2,
  FileSignature,
  Send,
  UserPlus,
} from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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

function Dashboard() {
  const { clients, formAssignments, monitoring, contracts, activity, programs } = useAppState();
  const today = new Date();

  const stats = [
    { label: "New Intakes", value: clients.filter((c) => c.status === "New Intake").length },
    { label: "Needs Review", value: clients.filter((c) => c.status === "Needs Review").length },
    {
      label: "Forms Sent",
      value: formAssignments.filter((f) =>
        ["sent", "delivered", "opened", "in_progress"].includes(f.status),
      ).length,
    },
    {
      label: "Active Clients",
      value: clients.filter((c) => ["Active", "Monitoring"].includes(c.status)).length,
    },
    {
      label: "Monitoring Due",
      value: monitoring.filter((m) => m.status === "Due" || m.status === "Overdue").length,
    },
    {
      label: "Contracts Pending",
      value: contracts.filter((c) => ["Draft", "Internal Review", "Sent"].includes(c.status))
        .length,
    },
    {
      label: "Completed This Month",
      value: clients.filter((c) => c.status === "Completed").length,
    },
    { label: "Archived Clients", value: clients.filter((c) => c.isArchived).length },
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
    <div className="space-y-6">
      <PageHeader
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
            <Button variant="outline" asChild>
              <Link to="/reports">
                <ArrowUpRight className="size-4" />
                Generate report
              </Link>
            </Button>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((s) => (
          <Card key={s.label} className="shadow-card">
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">{s.label}</p>
              <p className="mt-2 font-display text-3xl font-semibold tracking-tight">{s.value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="shadow-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-base">Recent activity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {activity.slice(0, 6).map((a) => (
              <div
                key={a.id}
                className="flex gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
              >
                <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary" />
                <div className="min-w-0">
                  <p className="text-sm font-medium">{a.action}</p>
                  <p className="text-sm text-muted-foreground">{a.description}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.user} · {new Date(a.timestamp).toLocaleDateString()}
                  </p>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Upcoming follow-ups</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {followUps.map((c) => (
              <Link
                key={c.id}
                to="/clients/$clientId"
                params={{ clientId: c.id }}
                className="flex items-start gap-3 rounded-lg p-2 transition-colors hover:bg-muted"
              >
                <CalendarClock className="mt-0.5 size-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">{c.businessName}</p>
                  <p className="text-xs text-muted-foreground">
                    {programName(c.programId)} ·{" "}
                    {new Date(c.nextFollowUpDate!).toLocaleDateString()}
                  </p>
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="font-display text-base">Clients needing attention</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {attention.map((c) => (
            <Link
              key={c.id}
              to="/clients/$clientId"
              params={{ clientId: c.id }}
              className="rounded-xl border border-border p-4 transition-shadow hover:shadow-elevated"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold">{c.businessName}</p>
                <StatusBadge status={c.status} />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {programName(c.programId)} · {c.assignedStaff}
              </p>
            </Link>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
