import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppState } from "@/lib/store";
import { recordMonitoringResult } from "@/lib/api";
import {
  isLiveMonitoring,
  monitoringBucket,
  type MonitoringBucket,
} from "@/lib/monitoring-buckets";

const labels: ReadonlyArray<readonly [MonitoringBucket, string]> = [
  ["overdue", "Overdue"],
  ["today", "Due today"],
  ["week", "Due this week"],
  ["upcoming", "Upcoming"],
  ["unscheduled", "Not scheduled"],
  ["done", "Done"],
];

export const Route = createFileRoute("/monitoring")({
  head: () => ({
    meta: [
      { title: "Monitoring — ClientFlow" },
      {
        name: "description",
        content:
          "Monitoring board grouped by due today, this week, overdue, upcoming and completed.",
      },
      { property: "og:title", content: "Monitoring — ClientFlow" },
      {
        property: "og:description",
        content:
          "Monitoring board grouped by due today, this week, overdue, upcoming and completed.",
      },
    ],
  }),
  component: MonitoringPage,
});

function MonitoringPage() {
  const { monitoring, clients, programs, enrollments } = useAppState();
  const [tab, setTab] = useState<MonitoringBucket>("today");
  const [savingId, setSavingId] = useState<string | null>(null);
  const now = Date.now();

  // Only monitoring on open, unarchived enrollments; each item sits in exactly one bucket.
  const live = monitoring.filter((item) => isLiveMonitoring(item, enrollments));
  const buckets = Object.fromEntries(
    labels.map(([key]) => [key, live.filter((item) => monitoringBucket(item, now) === key)]),
  ) as Record<MonitoringBucket, typeof monitoring>;

  async function record(id: string, complianceStatus: "compliant" | "non_compliant") {
    setSavingId(id);
    try {
      await recordMonitoringResult(id, { complianceStatus });
      toast.success("Monitoring review recorded");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to record the review.");
    } finally {
      setSavingId(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoring"
        description="Every active follow-up obligation, sorted by due date."
      />
      <Tabs value={tab} onValueChange={(value) => setTab(value as MonitoringBucket)}>
        <TabsList className="flex h-auto flex-wrap justify-start">
          {labels.map(([k, l]) => (
            <TabsTrigger key={k} value={k}>
              {l} ({buckets[k].length})
            </TabsTrigger>
          ))}
        </TabsList>
        {labels.map(([k]) => (
          <TabsContent key={k} value={k} className="mt-4 space-y-3">
            {buckets[k].map((m) => {
              const enrollment = enrollments.find((item) => item.id === m.enrollmentId);
              const client = clients.find((c) => c.id === enrollment?.clientId);
              return (
                <Card key={m.id} className="shadow-card">
                  <CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                    <div className="min-w-0">
                      {enrollment ? (
                        <Link
                          to="/clients/$clientId"
                          params={{ clientId: enrollment.clientId }}
                          className="font-medium hover:text-primary"
                        >
                          {client?.businessName ?? "Client"}
                        </Link>
                      ) : (
                        <span className="font-medium">Client</span>
                      )}
                      <p className="font-mono text-xs text-muted-foreground">
                        {programs.find((p) => p.id === enrollment?.programId)?.name} · {m.name} ·
                        Next review{" "}
                        {m.nextReviewAt
                          ? new Date(m.nextReviewAt).toLocaleDateString()
                          : "not scheduled"}
                      </p>
                      <p className="mt-1 text-sm text-muted-foreground">{m.notes}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <StatusBadge status={m.complianceStatus} />
                      {m.active ? (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={savingId === m.id}
                            onClick={() => void record(m.id, "non_compliant")}
                          >
                            Not compliant
                          </Button>
                          <Button
                            size="sm"
                            disabled={savingId === m.id}
                            onClick={() => void record(m.id, "compliant")}
                          >
                            Record compliant
                          </Button>
                        </>
                      ) : null}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
            {buckets[k].length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">Nothing here.</p>
            ) : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
