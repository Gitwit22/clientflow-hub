import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { useAppState } from "@/lib/store";
import { updateProgram } from "@/lib/api";

export const Route = createFileRoute("/programs")({
  head: () => ({
    meta: [
      { title: "Programs — ClientFlow" },
      { name: "description", content: "Manage program types, workflows, default forms, contracts and monitoring frequency." },
      { property: "og:title", content: "Programs — ClientFlow" },
      { property: "og:description", content: "Manage program types, workflows, default forms, contracts and monitoring frequency." },
    ],
  }),
  component: ProgramsPage,
});

function ProgramsPage() {
  const { programs, formTemplates } = useAppState();
  return (
    <div className="space-y-6">
      <PageHeader title="Programs" description="Each program drives its default form, contract template and monitoring cadence." />
      <div className="grid gap-4 lg:grid-cols-2">
        {programs.map((p) => (
          <Card key={p.id} className="shadow-card"><CardContent className="space-y-3 p-6">
            <div className="flex items-start justify-between gap-4">
              <div><h2 className="font-display text-lg font-semibold">{p.name}</h2>
                <p className="mt-1 text-sm text-muted-foreground">{p.description}</p></div>
              <Switch checked={p.isActive} onCheckedChange={(v) => updateProgram(p.id, { isActive: v })} />
            </div>
            <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-muted-foreground uppercase">Default form</dt><dd>{formTemplates.find((f) => f.id === p.defaultFormTemplateId)?.name ?? "—"}</dd></div>
              <div><dt className="text-xs text-muted-foreground uppercase">Contract template</dt><dd>{p.defaultContractTemplateId}</dd></div>
              <div><dt className="text-xs text-muted-foreground uppercase">Monitoring</dt><dd>{p.defaultMonitoringFrequency}</dd></div>
              <div><dt className="text-xs text-muted-foreground uppercase">Required documents</dt><dd>{p.requiredDocuments.join(", ") || "None"}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground uppercase">Default workflow</dt><dd>{p.defaultWorkflow.join(" → ")}</dd></div>
              <div className="sm:col-span-2"><dt className="text-xs text-muted-foreground uppercase">Status pipeline</dt><dd>{p.statusPipeline.join(" → ")}</dd></div>
            </dl>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}
