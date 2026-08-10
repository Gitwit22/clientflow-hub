import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAppState } from "@/lib/store";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — ClientFlow" },
      {
        name: "description",
        content: "Program, intake, funding, monitoring and contract status reporting.",
      },
      { property: "og:title", content: "Reports — ClientFlow" },
      {
        property: "og:description",
        content: "Program, intake, funding, monitoring and contract status reporting.",
      },
    ],
  }),
  component: ReportsPage,
});

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-sans text-sm">{label}</span>
        <span className="font-mono text-sm font-medium">{value}</span>
      </div>
      <div className="h-1.5 rounded-full bg-muted">
        <div
          className="h-1.5 rounded-full bg-primary"
          style={{ width: `${max ? (value / max) * 100 : 0}%` }}
        />
      </div>
    </div>
  );
}

function ReportsPage() {
  const { clients, programs, monitoring, contracts, terms } = useAppState();
  const byProgram = programs.map((p) => ({
    label: p.name,
    value: clients.filter((c) => c.programId === p.id && !c.isArchived).length,
  }));
  const maxProgram = Math.max(1, ...byProgram.map((b) => b.value));
  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - (5 - i));
    const label = d.toLocaleString(undefined, { month: "short" });
    const value = clients.filter((c) => new Date(c.createdAt).getMonth() === d.getMonth()).length;
    return { label, value };
  });
  const maxMonth = Math.max(1, ...months.map((m) => m.value));
  const funding = terms.reduce((sum, t) => sum + t.fundingAmount, 0);
  const contractStatus = ["Draft", "Internal Review", "Sent", "Signed", "Completed"].map((s) => ({
    label: s,
    value: contracts.filter((c) => c.status === s).length,
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Portfolio view across programs, intake volume, funding and compliance."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Active clients by program</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {byProgram.map((b) => (
              <Bar key={b.label} {...b} max={maxProgram} />
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">New intakes by month</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {months.map((m) => (
              <Bar key={m.label} {...m} max={maxMonth} />
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Contract status report</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {contractStatus.map((c) => (
              <Bar key={c.label} {...c} max={Math.max(1, ...contractStatus.map((x) => x.value))} />
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Portfolio summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            {[
              [
                "Approved clients",
                clients.filter((c) =>
                  ["Approved", "Active", "Monitoring", "Completed"].includes(c.status),
                ).length,
              ],
              ["Declined clients", clients.filter((c) => c.status === "Declined").length],
              ["Monitoring due", monitoring.filter((m) => m.status !== "Completed").length],
              ["Completed clients", clients.filter((c) => c.status === "Completed").length],
              ["Archived clients", clients.filter((c) => c.isArchived).length],
              ["Funding committed", `$${funding.toLocaleString()}`],
            ].map(([l, v]) => (
              <div key={String(l)} className="rounded-xl border border-border p-4">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">{l}</p>
                <p className="mt-1 font-display text-2xl font-semibold">{v}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
