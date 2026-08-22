import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Plus } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { emailTemplateBody } from "@/data/mock";
import { useAppState } from "@/lib/store";
import { AddEditFormTemplateDialog } from "@/components/dialogs/AddEditFormTemplateDialog";
import { SendFormFlowDialog } from "@/components/dialogs/SendFormFlowDialog";
import type { FormTemplate } from "@/types";

export const Route = createFileRoute("/forms")({
  head: () => ({
    meta: [
      { title: "Forms — ClientFlow" },
      {
        name: "description",
        content: "Form template manager with program-specific question sets and email messaging.",
      },
      { property: "og:title", content: "Forms — ClientFlow" },
      {
        property: "og:description",
        content: "Form template manager with program-specific question sets and email messaging.",
      },
    ],
  }),
  component: FormsPage,
});

function FormsPage() {
  const { formTemplates, programs, intakeSubmissions, clients } = useAppState();
  const [openId, setOpenId] = useState<string | null>(formTemplates[0]?.id ?? null);
  const [view, setView] = useState<"master" | "sections" | "submissions">("master");
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<FormTemplate | undefined>(undefined);
  const [sendFormOpen, setSendFormOpen] = useState(false);
  const [sendFormTemplateId, setSendFormTemplateId] = useState<string | undefined>(undefined);

  function openTemplateAdd() {
    setEditingTemplate(undefined);
    setTemplateDialogOpen(true);
  }

  function openTemplateEdit(t: FormTemplate) {
    setEditingTemplate(t);
    setTemplateDialogOpen(true);
  }

  const clientName = (id: string) => clients.find((c) => c.id === id)?.businessName ?? id;
  const masterTemplates = formTemplates.filter((template) => template.scope === "master_core");
  const sectionTemplates = formTemplates
    .filter((template) => template.scope === "program_section")
    .sort((left, right) => (left.sortOrder ?? 0) - (right.sortOrder ?? 0));
  const displayedTemplates = view === "master" ? masterTemplates : sectionTemplates;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Forms"
        description={
          view === "master"
            ? "Configure the shared questions that begin every intake."
            : view === "sections"
              ? "Configure the questions revealed when each program is selected."
              : "Immutable history of submitted Master Intakes."
        }
        actions={
          view === "sections" ? (
            <Button size="sm" onClick={openTemplateAdd}>
              <Plus className="mr-1.5 h-4 w-4" />
              New template
            </Button>
          ) : undefined
        }
      />

      {/* Intake configuration / history */}
      <div className="inline-flex rounded-lg border border-border bg-muted p-1 gap-1">
        <button
          onClick={() => {
            setView("master");
            setOpenId(masterTemplates[0]?.id ?? null);
          }}
          className={`rounded-md px-4 py-1.5 font-mono text-[10.5px] uppercase tracking-wide transition-colors ${view === "master" ? "bg-ink text-ink-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          Master Intake
        </button>
        <button
          onClick={() => {
            setView("sections");
            setOpenId(sectionTemplates[0]?.id ?? null);
          }}
          className={`rounded-md px-4 py-1.5 font-mono text-[10.5px] uppercase tracking-wide transition-colors ${view === "sections" ? "bg-ink text-ink-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          Program Sections
        </button>
        <button
          onClick={() => setView("submissions")}
          className={`rounded-md px-4 py-1.5 font-mono text-[10.5px] uppercase tracking-wide transition-colors ${view === "submissions" ? "bg-ink text-ink-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          Submission History
        </button>
      </div>

      {/* CONFIGURATION VIEW */}
      {view !== "submissions" && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-2">
            {displayedTemplates.map((t) => (
              <button
                key={t.id}
                onClick={() => setOpenId(t.id)}
                className={`w-full rounded-xl border p-4 text-left transition-colors ${openId === t.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"}`}
              >
                <p className="text-sm font-semibold">{t.name}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {programs.find((p) => p.id === t.programId)?.name}
                </p>
              </button>
            ))}
          </div>
          {displayedTemplates
            .filter((t) => t.id === openId)
            .map((t) => (
              <Card key={t.id} className="shadow-card">
                <CardContent className="space-y-5 p-6">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <h2 className="font-display text-lg font-semibold">{t.name}</h2>
                      <p className="text-sm text-muted-foreground">{t.description}</p>
                    </div>
                    <StatusBadge status={t.isActive ? "Active" : "Draft"} />
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Questions
                    </p>
                    <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                      {t.fields.map((f) => (
                        <li
                          key={f.id}
                          className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                        >
                          <span>{f.label}</span>
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {f.type}
                            {f.required ? " · required" : " · optional"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Due date setting
                      </p>
                      <p className="text-sm">{t.dueInDays} days after send</p>
                    </div>
                    <div>
                      <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                        Internal notes
                      </p>
                      <p className="text-sm">{t.internalNotes ?? "—"}</p>
                    </div>
                  </div>
                  <div>
                    <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                      Email message template
                    </p>
                    <pre className="mt-2 rounded-xl bg-muted p-4 font-sans text-sm whitespace-pre-wrap text-muted-foreground">
                      {emailTemplateBody}
                    </pre>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" size="sm">
                      Preview
                    </Button>
                    <Button variant="outline" size="sm">
                      Fill Out Form
                    </Button>
                    {t.scope === "master_core" && (
                      <Button
                        size="sm"
                        onClick={() => {
                          setSendFormTemplateId(t.id);
                          setSendFormOpen(true);
                        }}
                      >
                        Send Master Intake
                      </Button>
                    )}
                    <Button variant="outline" size="sm" onClick={() => openTemplateEdit(t)}>
                      Edit template
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
        </div>
      )}

      {/* SUBMISSIONS VIEW */}
      {view === "submissions" && (
        <div className="space-y-4">
          <div className="space-y-2">
            {intakeSubmissions.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No Master Intake submissions yet.
              </p>
            )}
            {intakeSubmissions.map((submission) => (
              <Card key={submission.id} className="shadow-card">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-sm">Master Intake</p>
                      <StatusBadge status="submitted" />
                    </div>
                    <p className="font-mono text-xs text-muted-foreground mt-0.5">
                      Profile:{" "}
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: submission.clientId }}
                        className="hover:text-primary font-medium"
                      >
                        {submission.client?.businessName ?? clientName(submission.clientId)}
                      </Link>
                      {` · ${submission.programs.length} program${submission.programs.length === 1 ? "" : "s"}`}
                      {` · ${submission.source.replace(/_/g, " ")}`}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      Submitted {new Date(submission.submittedAt).toLocaleString()}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/clients/$clientId" params={{ clientId: submission.clientId }}>
                      View profile
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
      <AddEditFormTemplateDialog
        template={editingTemplate}
        open={templateDialogOpen}
        onOpenChange={setTemplateDialogOpen}
      />
      <SendFormFlowDialog
        open={sendFormOpen}
        onOpenChange={setSendFormOpen}
        preselectedTemplateId={sendFormTemplateId}
      />
    </div>
  );
}
