import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAppState } from "@/lib/store";
import { completeMonitoringItem, rescheduleMonitoringItem } from "@/lib/api";

export const Route = createFileRoute("/monitoring")({
  head: () => ({
    meta: [
      { title: "Monitoring — ClientFlow" },
      { name: "description", content: "Monitoring board grouped by due today, this week, overdue, upcoming and completed." },
      { property: "og:title", content: "Monitoring — ClientFlow" },
      { property: "og:description", content: "Monitoring board grouped by due today, this week, overdue, upcoming and completed." },
    ],
  }),
  component: MonitoringPage,
});

const day = 864e5;

function MonitoringPage() {
  const { monitoring, clients, programs } = useAppState();
  const [tab, setTab] = useState("today");
  const now = Date.now();

  const buckets: Record<string, typeof monitoring> = {
    today: monitoring.filter((m) => m.status !== "Completed" && Math.abs(new Date(m.dueDate).getTime() - now) < day),
    week: monitoring.filter((m) => m.status !== "Completed" && new Date(m.dueDate).getTime() - now > 0 && new Date(m.dueDate).getTime() - now <= 7 * day),
    overdue: monitoring.filter((m) => m.status !== "Completed" && new Date(m.dueDate).getTime() < now - day),
    upcoming: monitoring.filter((m) => m.status !== "Completed" && new Date(m.dueDate).getTime() - now > 7 * day),
    completed: monitoring.filter((m) => m.status === "Completed"),
  };

  const labels = [["today","Due today"],["week","Due this week"],["overdue","Overdue"],["upcoming","Upcoming"],["completed","Completed"]] as const;

  return (
    <div className="space-y-6">
      <PageHeader title="Monitoring" description="Every active follow-up obligation, sorted by due date." />
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="flex h-auto flex-wrap justify-start">
          {labels.map(([k, l]) => <TabsTrigger key={k} value={k}>{l} ({buckets[k].length})</TabsTrigger>)}
        </TabsList>
        {labels.map(([k]) => (
          <TabsContent key={k} value={k} className="mt-4 space-y-3">
            {buckets[k].map((m) => {
              const client = clients.find((c) => c.id === m.clientId);
              return (
                <Card key={m.id} className="shadow-card"><CardContent className="flex flex-wrap items-center justify-between gap-4 p-5">
                  <div className="min-w-0">
                    <Link to="/clients/$clientId" params={{ clientId: m.clientId }} className="font-medium hover:text-primary">{client?.businessName}</Link>
                    <p className="text-xs text-muted-foreground">
                      {programs.find((p) => p.id === m.programId)?.name} · {m.type} · Due {new Date(m.dueDate).toLocaleDateString()} · {m.assignedStaff}
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">{m.notes}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={m.status} />
                    {m.status !== "Completed" ? (
                      <>
                        <Button size="sm" onClick={() => { completeMonitoringItem(m.id); toast.success("Marked complete"); }}>Mark complete</Button>
                        <Button size="sm" variant="outline" onClick={() => { rescheduleMonitoringItem(m.id, new Date(Date.now() + 14 * day).toISOString()); toast.success("Rescheduled 2 weeks out"); }}>Reschedule</Button>
                      </>
                    ) : null}
                  </div>
                </CardContent></Card>
              );
            })}
            {buckets[k].length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">Nothing here.</p> : null}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}
