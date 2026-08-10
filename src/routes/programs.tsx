import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Pencil, Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { useAppState } from "@/lib/store";
import { updateProgram } from "@/lib/api";
import { AddEditProgramDialog } from "@/components/dialogs/AddEditProgramDialog";
import type { Program } from "@/types";

export const Route = createFileRoute("/programs")({
  head: () => ({
    meta: [
      { title: "Programs — ClientFlow" },
      {
        name: "description",
        content:
          "Manage program types, workflows, default forms, contracts and monitoring frequency.",
      },
      { property: "og:title", content: "Programs — ClientFlow" },
      {
        property: "og:description",
        content:
          "Manage program types, workflows, default forms, contracts and monitoring frequency.",
      },
    ],
  }),
  component: ProgramsPage,
});

function ProgramsPage() {
  const { programs, formTemplates, clients } = useAppState();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingProgram, setEditingProgram] = useState<Program | undefined>(undefined);

  function openAdd() {
    setEditingProgram(undefined);
    setDialogOpen(true);
  }

  function openEdit(p: Program) {
    setEditingProgram(p);
    setDialogOpen(true);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Programs"
        description="Each program drives its default form, contract template and monitoring cadence."
        actions={
          <Button size="sm" onClick={openAdd}>
            <Plus className="mr-1.5 h-4 w-4" />
            New program
          </Button>
        }
      />
      <div className="grid gap-4 lg:grid-cols-2">
        {programs.map((p) => (
          <Card key={p.id} className="shadow-card">
            <CardContent className="space-y-3 p-6">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0 flex-1">
                  <h2 className="font-display text-lg font-semibold">{p.name}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">{p.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(p)}
                    aria-label="Edit program"
                  >
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Switch
                    checked={p.isActive}
                    onCheckedChange={(v) => updateProgram(p.id, { isActive: v })}
                  />
                </div>
              </div>
              <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Default form</dt>
                  <dd>
                    {formTemplates.find((f) => f.id === p.defaultFormTemplateId)?.name ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Contract template</dt>
                  <dd>{p.defaultContractTemplateId}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Monitoring</dt>
                  <dd>{p.defaultMonitoringFrequency}</dd>
                </div>
                <div>
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Required documents</dt>
                  <dd>{p.requiredDocuments.join(", ") || "None"}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Default workflow</dt>
                  <dd>{p.defaultWorkflow.join(" → ")}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">Status pipeline</dt>
                  <dd>{p.statusPipeline.join(" → ")}</dd>
                </div>
              </dl>
              {(() => {
                const active = clients.filter((c) => c.programId === p.id && !c.isArchived);
                return active.length > 0 ? (
                  <div className="border-t border-border pt-3">
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground mb-2">
                      Active clients ({active.length})
                    </p>
                    <ul className="space-y-1">
                      {active.map((c) => (
                        <li key={c.id} className="flex items-center justify-between text-sm">
                          <Link
                            to="/clients/$clientId"
                            params={{ clientId: c.id }}
                            className="font-medium hover:text-primary"
                          >
                            {c.businessName}
                          </Link>
                          <span className="text-xs text-muted-foreground">{c.status}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground border-t border-border pt-3">No active clients</p>
                );
              })()}
            </CardContent>
          </Card>
        ))}
      </div>

      <AddEditProgramDialog
        program={editingProgram}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
