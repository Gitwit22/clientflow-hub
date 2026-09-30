import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { cfGetBillingDashboard } from "@/lib/apiClient";
import type { OrgBillingDashboard } from "@/types";
import { formatMoney } from "@/lib/money";

export const Route = createFileRoute("/payments")({
  head: () => ({
    meta: [
      { title: "Payments — ClientFlow" },
      {
        name: "description",
        content: "Revenue dashboard, expected payments, and billing setup queue.",
      },
    ],
  }),
  component: PaymentsPage,
});

function money(value: number) {
  return formatMoney(value, { whole: true });
}

function PaymentsPage() {
  const [period, setPeriod] = useState<"month" | "quarter" | "year">("month");
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
        if (!cancelled)
          setError(err instanceof Error ? err.message : "Unable to load the billing dashboard.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period]);

  const revenue = dashboard?.revenue;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payments"
        description="Billing agreements, the payment ledger, and revenue forecasting."
        actions={
          <Select value={period} onValueChange={(value) => setPeriod(value as typeof period)}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="month">Month</SelectItem>
              <SelectItem value="quarter">Quarter</SelectItem>
              <SelectItem value="year">Year</SelectItem>
            </SelectContent>
          </Select>
        }
      />

      {error && (
        <Card className="shadow-card">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
            <Button className="mt-4" variant="outline" onClick={() => setPeriod((p) => p)}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-sm text-muted-foreground">Received</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold">
              {loading ? "—" : money(revenue?.received ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-sm text-muted-foreground">Expected</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold">
              {loading ? "—" : money(revenue?.expected ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-sm text-muted-foreground">
              Outstanding
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold">
              {loading ? "—" : money(revenue?.outstanding ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-sm text-muted-foreground">
              Active recurring revenue
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-display text-2xl font-semibold">
              {loading ? "—" : money(revenue?.activeRecurringRevenue ?? 0)}
            </p>
          </CardContent>
        </Card>
      </div>

      {dashboard && dashboard.needsBillingSetup.length > 0 && (
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Needs Billing Setup</CardTitle>
            <p className="text-xs text-muted-foreground">
              {dashboard.needsBillingSetup.length} client
              {dashboard.needsBillingSetup.length === 1 ? "" : "s"} need payment setup.
            </p>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead>Enrollment date</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.needsBillingSetup.map((row) => (
                  <TableRow key={row.enrollmentId}>
                    <TableCell>{row.clientName}</TableCell>
                    <TableCell>{row.programName}</TableCell>
                    <TableCell>
                      {row.enrollmentDate ? new Date(row.enrollmentDate).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button size="sm" variant="outline" asChild>
                        <Link
                          to="/clients/$clientId"
                          params={{ clientId: row.clientId }}
                          search={{ enrollmentId: row.enrollmentId, tab: "billing" }}
                        >
                          Set Up Payments
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <Card className="shadow-card">
        <CardHeader>
          <CardTitle className="font-display text-base">Expected payments</CardTitle>
        </CardHeader>
        <CardContent>
          {!dashboard || dashboard.expectedPayments.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">
              {loading ? "Loading..." : "No payments expected in this period."}
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Client</TableHead>
                  <TableHead>Program</TableHead>
                  <TableHead>Period</TableHead>
                  <TableHead>Due</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {dashboard.expectedPayments.map((row, index) => (
                  <TableRow key={`${row.enrollmentId}-${row.dueDate}-${index}`}>
                    <TableCell>
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: row.clientId }}
                        search={{ enrollmentId: row.enrollmentId, tab: "billing" }}
                        className="hover:text-primary"
                      >
                        {row.clientName}
                      </Link>
                    </TableCell>
                    <TableCell>{row.programName}</TableCell>
                    <TableCell>{row.period}</TableCell>
                    <TableCell>{new Date(row.dueDate).toLocaleDateString()}</TableCell>
                    <TableCell>{money(row.amount)}</TableCell>
                    <TableCell>
                      <StatusBadge status={row.status} />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
