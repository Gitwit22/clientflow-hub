import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cfGetBillingDashboard } from "@/lib/apiClient";
import {
  isActiveEnrollmentStatus,
  isOnboardingEnrollmentStatus,
  isTerminalEnrollmentStatus,
  uniqueEnrollments,
} from "@/lib/enrollment-status";
import { useAppState } from "@/lib/store";
import { isLiveMonitoring, monitoringBucket } from "@/lib/monitoring-buckets";
import type { OrgBillingDashboard } from "@/types";

export const Route = createFileRoute("/reports")({
  head: () => ({
    meta: [
      { title: "Reports — ClientFlow" },
      {
        name: "description",
        content: "Program, intake, revenue, monitoring and contract status reporting.",
      },
      { property: "og:title", content: "Reports — ClientFlow" },
      {
        property: "og:description",
        content: "Program, intake, revenue, monitoring and contract status reporting.",
      },
    ],
  }),
  component: ReportsPage,
});

type Period = "month" | "quarter" | "year";
const PERIOD_LABELS: Record<Period, string> = {
  month: "This month",
  quarter: "This quarter",
  year: "This year",
};

function money(value: number) {
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

function Bar({
  label,
  value,
  max,
  display,
}: {
  label: string;
  value: number;
  max: number;
  display?: string;
}) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between gap-3 text-sm">
        <span className="font-sans text-sm">{label}</span>
        <span className="font-mono text-sm font-medium">{display ?? value}</span>
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

function Stat({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="rounded-xl border border-border p-4">
      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </p>
      <p className="mt-1 font-display text-2xl font-semibold">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function useBillingDashboard(period: Period) {
  const [dashboard, setDashboard] = useState<OrgBillingDashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    void cfGetBillingDashboard(period)
      .then((result) => {
        if (!cancelled) setDashboard(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Unable to load revenue.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);
  return { dashboard, loading, error };
}

function ReportsPage() {
  const { clients, programs, enrollments, monitoring, contracts, terms } = useAppState();
  const [period, setPeriod] = useState<Period>("month");
  const { dashboard, loading, error } = useBillingDashboard(period);

  // Program membership comes from enrollments (a client can be in several programs).
  const liveEnrollments = uniqueEnrollments(enrollments).filter((e) => !e.isArchived);
  const byProgram = programs
    .map((p) => ({
      label: p.name,
      value: new Set(
        liveEnrollments
          .filter((e) => e.programId === p.id && !isTerminalEnrollmentStatus(e.status))
          .map((e) => e.clientId),
      ).size,
    }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
  const maxProgram = Math.max(1, ...byProgram.map((b) => b.value));

  const months = Array.from({ length: 6 }, (_, i) => {
    const d = new Date();
    d.setDate(1);
    d.setMonth(d.getMonth() - (5 - i));
    const label = d.toLocaleString(undefined, { month: "short", year: "2-digit" });
    const value = clients.filter((c) => {
      const created = new Date(c.createdAt);
      return created.getFullYear() === d.getFullYear() && created.getMonth() === d.getMonth();
    }).length;
    return { label, value };
  });
  const maxMonth = Math.max(1, ...months.map((m) => m.value));

  const contractStatus = ["DRAFT", "SENT", "OPENED", "COMPLETED", "CANCELLED", "EXPIRED"].map(
    (s) => ({
      label: s,
      value: contracts.filter((c) => c.status === s).length,
    }),
  );
  const maxContract = Math.max(1, ...contractStatus.map((x) => x.value));

  // Open statuses count live enrollments; outcomes (completed, declined, withdrawn) count every
  // enrollment, archived ones included, so a finished client isn't lost once archived.
  const allEnrollments = uniqueEnrollments(enrollments);
  const clientsWith = (match: (status: string) => boolean) =>
    new Set(
      allEnrollments
        .filter((e) => match(e.status) && (isTerminalEnrollmentStatus(e.status) || !e.isArchived))
        .map((e) => e.clientId),
    ).size;
  const now = Date.now();
  const monitoringDue = monitoring.filter(
    (m) =>
      isLiveMonitoring(m, enrollments) && ["overdue", "today"].includes(monitoringBucket(m, now)),
  ).length;
  const funding = terms.reduce((sum, t) => sum + (Number(t.fundingAmount) || 0), 0);

  const revenue = dashboard?.revenue;
  const revenueByProgram = dashboard?.receivedByProgram ?? [];
  const maxRevenue = Math.max(1, ...revenueByProgram.map((r) => r.received));
  const show = (value: number | undefined, format: (v: number) => string | number = (v) => v) =>
    loading ? "—" : format(value ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Reports"
        description="Portfolio view across programs, intake volume, revenue and compliance."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-card lg:col-span-2">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
            <div>
              <CardTitle className="font-display text-base">Revenue</CardTitle>
              <p className="mt-1 text-xs text-muted-foreground">
                From recorded client payments and billing agreements.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" asChild>
                <Link to="/payments">Payments</Link>
              </Button>
              <Select value={period} onValueChange={(value) => setPeriod(value as Period)}>
                <SelectTrigger className="w-36">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(Object.keys(PERIOD_LABELS) as Period[]).map((key) => (
                    <SelectItem key={key} value={key}>
                      {PERIOD_LABELS[key]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardHeader>
          <CardContent className="space-y-5">
            {error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Stat
                    label="Received"
                    value={show(revenue?.received, money)}
                    hint={PERIOD_LABELS[period]}
                  />
                  <Stat
                    label="Outstanding"
                    value={show(revenue?.outstanding, money)}
                    hint="Owed through period end"
                  />
                  <Stat
                    label="Recurring revenue"
                    value={show(revenue?.activeRecurringRevenue, money)}
                    hint="Monthly, active agreements"
                  />
                  <Stat
                    label="Paying clients"
                    value={show(dashboard?.payingClients)}
                    hint="Active billing agreements"
                  />
                </div>
                <div className="space-y-3">
                  <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                    Received by program
                  </p>
                  {loading ? (
                    <p className="text-sm text-muted-foreground">Loading...</p>
                  ) : revenueByProgram.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      No payments recorded {PERIOD_LABELS[period].toLowerCase()}.
                    </p>
                  ) : (
                    revenueByProgram.map((row) => (
                      <Bar
                        key={row.programId}
                        label={`${row.programName} · ${row.payingClients} client${row.payingClients === 1 ? "" : "s"}`}
                        value={row.received}
                        max={maxRevenue}
                        display={money(row.received)}
                      />
                    ))
                  )}
                </div>
              </>
            )}
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Current members by program</CardTitle>
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
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <CardTitle className="font-display text-base">Contract status report</CardTitle>
            <Button variant="outline" size="sm" asChild>
              <Link to="/clients">Contract queue</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            {contractStatus.map((c) => (
              <Bar key={c.label} {...c} max={maxContract} />
            ))}
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Portfolio summary</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Stat label="Onboarding clients" value={clientsWith(isOnboardingEnrollmentStatus)} />
            <Stat label="Active clients" value={clientsWith(isActiveEnrollmentStatus)} />
            <Stat label="Completed clients" value={clientsWith((s) => s === "completed")} />
            <Stat
              label="Declined / withdrawn"
              value={clientsWith((s) => s === "declined" || s === "withdrawn")}
            />
            <Stat label="Monitoring due" value={monitoringDue} />
            <Stat label="Funding committed" value={money(funding)} hint="From client terms" />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
