import { createFileRoute, Link } from "@tanstack/react-router";
import { AlertTriangle, Send, UserPlus } from "lucide-react";
import { useState } from "react";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { AddClientDialog } from "@/components/dialogs/AddClientDialog";
import { lifecycleBucket } from "@/lib/client-lifecycle";
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

function Dashboard() {
  const { clients, contracts, communications, activity, programs, enrollments } = useAppState();
  const [addClientOpen, setAddClientOpen] = useState(false);
  const today = new Date();
  const todayLabel = today.toLocaleDateString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const summary = clients.reduce(
    (acc, c) => {
      const clientEnrollments = enrollments.filter((enrollment) => enrollment.clientId === c.id);
      acc[lifecycleBucket(c, clientEnrollments)] += 1;
      return acc;
    },
    { onboarding: 0, active: 0, archived: 0 },
  );

  const missingProgramClients = clients.filter((c) => !c.isArchived && !c.programId);
  const draftContractClientIds = new Set(
    contracts
      .filter((contract) => contract.status === "DRAFT")
      .map((contract) => contract.clientId),
  );
  const draftContractClients = clients.filter((c) => draftContractClientIds.has(c.id));
  const failedDeliveryClientIds = new Set(
    communications
      .filter((comm) => Boolean(comm.errorCode) || comm.status === "FAILED")
      .map((comm) => comm.clientId),
  );
  const failedDeliveryClients = clients.filter((c) => failedDeliveryClientIds.has(c.id));

  const attentionCategories = [
    { key: "program", label: "Missing program assignment", items: missingProgramClients },
    { key: "contract", label: "Contract awaiting staff action", items: draftContractClients },
    { key: "delivery", label: "Failed email delivery", items: failedDeliveryClients },
  ].filter((category) => category.items.length > 0);
  const attentionTotal = attentionCategories.reduce(
    (sum, category) => sum + category.items.length,
    0,
  );

  const followUps = clients
    .filter((c) => !c.isArchived && c.nextFollowUpDate)
    .sort((a, b) => (a.nextFollowUpDate! < b.nextFollowUpDate! ? -1 : 1))
    .slice(0, 5);

  const programName = (id: string | null) =>
    programs.find((p) => p.id === id)?.name ?? "Unassigned";

  return (
    <div className="space-y-7">
      <PageHeader
        eyebrow={`Today · ${todayLabel}`}
        title="Dashboard"
        description="What needs attention today, across every client."
        actions={
          <>
            <Button onClick={() => setAddClientOpen(true)}>
              <UserPlus className="size-4" />
              Add client
            </Button>
            <Button variant="outline" asChild>
              <Link to="/clients">
                <Send className="size-4" />
                Go to clients
              </Link>
            </Button>
          </>
        }
      />

      <AddClientDialog open={addClientOpen} onOpenChange={setAddClientOpen} />

      {/* Lifecycle summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[
          { label: "Onboarding", value: summary.onboarding, color: "#6C5A8C" },
          { label: "Active", value: summary.active, color: "#3F7A4C" },
          { label: "Archived", value: summary.archived, color: "#7A7A72" },
          { label: "Needs Attention", value: attentionTotal, color: "#BE5138" },
        ].map((tile) => (
          <div
            key={tile.label}
            className="rounded-lg border border-border bg-card p-4"
            style={{ borderLeftWidth: "3px", borderLeftColor: tile.color }}
          >
            <span className="text-xs text-muted-foreground">{tile.label}</span>
            <p className="mt-2.5 font-display text-[30px] font-semibold leading-none text-foreground">
              {tile.value}
            </p>
          </div>
        ))}
      </div>

      {/* Needs Attention */}
      <div>
        <div className="mb-3.5 flex items-baseline justify-between">
          <h2 className="font-display text-[19px] font-semibold text-foreground">
            Needs Attention
          </h2>
          <span className="font-mono text-[11.5px] text-muted-foreground">
            {attentionTotal} flagged
          </span>
        </div>
        {attentionCategories.length === 0 ? (
          <p className="rounded-lg border border-border bg-card p-6 text-center text-sm text-muted-foreground">
            Nothing needs attention right now.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-3">
            {attentionCategories.map((category) => (
              <Card key={category.key} className="overflow-hidden">
                <div className="flex items-baseline justify-between border-b border-border px-5 py-4">
                  <h3 className="flex items-center gap-1.5 font-display text-[15px] font-semibold text-foreground">
                    <AlertTriangle className="size-3.5 text-[#BE5138]" />
                    {category.label}
                  </h3>
                  <span className="font-mono text-[11px] text-muted-foreground">
                    {category.items.length}
                  </span>
                </div>
                <div>
                  {category.items.slice(0, 5).map((c) => (
                    <Link
                      key={c.id}
                      to="/clients/$clientId"
                      params={{ clientId: c.id }}
                      className="group flex items-center justify-between gap-3 border-b border-border px-5 py-3 text-sm last:border-0 hover:text-primary"
                    >
                      <span className="font-medium text-foreground group-hover:text-primary">
                        {c.businessName}
                      </span>
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        {programName(c.programId)}
                      </span>
                    </Link>
                  ))}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

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
    </div>
  );
}
