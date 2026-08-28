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

const day = 864e5;

function MonitoringPage() {
  const { monitoring, clients, programs, enrollments } = useAppState();
  const [tab, setTab] = useState("today");
  const now = Date.now();

  const buckets: Record<string, typeof monitoring> = {
    today: monitoring.filter(
      (m) => m.active && m.nextReviewAt && Math.abs(new Date(m.nextReviewAt).getTime() - now) < day,
    ),
    week: monitoring.filter(
      (m) =>
        m.active &&
        m.nextReviewAt &&
        new Date(m.nextReviewAt).getTime() - now > 0 &&
        new Date(m.nextReviewAt).getTime() - now <= 7 * day,
    ),
    overdue: monitoring.filter(
      (m) => m.active && m.nextReviewAt && new Date(m.nextReviewAt).getTime() < now - day,
    ),
    upcoming: monitoring.filter(
      (m) => m.active && m.nextReviewAt && new Date(m.nextReviewAt).getTime() - now > 7 * day,
    ),
    completed: monitoring.filter((m) => m.lastReviewedAt),
  };

  const labels = [
    ["today", "Due today"],
    ["week", "Due this week"],
    ["overdue", "Overdue"],
    ["upcoming", "Upcoming"],
    ["completed", "Completed"],
  ] as const;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Monitoring"
        description="Every active follow-up obligation, sorted by due date."
      />
      <Tabs value={tab} onValueChange={setTab}>
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
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: enrollment?.clientId ?? "" }}
                        className="font-medium hover:text-primary"
                      >
                        {client?.businessName}
                      </Link>
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
                      <Button
                        size="sm"
                        onClick={() => {
                          void recordMonitoringResult(m.id, { complianceStatus: "compliant" });
                          toast.success("Monitoring review recorded");
                        }}
                      >
                        Record compliant
                      </Button>
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
