import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { emailTemplateBody } from "@/data/mock";
import { useAppState } from "@/lib/store";

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

const SUBMISSION_FILTERS = [
  { value: "all", label: "All" },
  { value: "interest", label: "Interest" },
  { value: "sponsorship", label: "Sponsorship" },
  { value: "draft", label: "Draft" },
  { value: "in_progress", label: "In Progress" },
  { value: "submitted", label: "Submitted" },
  { value: "under_review", label: "Under Review" },
  { value: "approved", label: "Approved" },
  { value: "cancelled", label: "Archived" },
] as const;

function FormsPage() {
  const { formTemplates, programs, formAssignments, clients } = useAppState();
  const [openId, setOpenId] = useState<string | null>(formTemplates[0]?.id ?? null);
  const [view, setView] = useState<"templates" | "submissions">("templates");
  const [submissionFilter, setSubmissionFilter] = useState("all");

  const clientName = (id: string) => clients.find((c) => c.id === id)?.businessName ?? id;
  const templateName = (id: string) => formTemplates.find((t) => t.id === id)?.name ?? id;
  const programOfTemplate = (fId: string) => {
    const t = formTemplates.find((x) => x.id === fId);
    return programs.find((p) => p.id === t?.programId)?.name ?? "—";
  };

  const filteredSubmissions = formAssignments.filter((a) => {
    if (submissionFilter === "all") return true;
    if (submissionFilter === "interest") return a.formId === "form-interest";
    if (submissionFilter === "sponsorship") return a.formId === "form-sponsorship";
    return a.status === submissionFilter;
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="Forms"
        description={
          view === "templates"
            ? "Structured templates sent by secure link and prefilled from the client profile."
            : "Cross-profile view of all form assignments and submissions."
        }
      />

      {/* Templates / Submissions toggle */}
      <div className="inline-flex rounded-lg border border-border bg-muted p-1 gap-1">
        <button
          onClick={() => setView("templates")}
          className={`rounded-md px-4 py-1.5 font-mono text-[10.5px] uppercase tracking-wide transition-colors ${view === "templates" ? "bg-ink text-ink-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          Templates
        </button>
        <button
          onClick={() => setView("submissions")}
          className={`rounded-md px-4 py-1.5 font-mono text-[10.5px] uppercase tracking-wide transition-colors ${view === "submissions" ? "bg-ink text-ink-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        >
          Submissions
        </button>
      </div>

      {/* TEMPLATES VIEW */}
      {view === "templates" && (
        <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="space-y-2">
            {formTemplates.map((t) => (
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
          {formTemplates
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
                    <Button size="sm" asChild>
                      <Link to="/intake">Send Form</Link>
                    </Button>
                    <Button variant="outline" size="sm">
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
          {/* Submission filters */}
          <div className="flex flex-wrap gap-1">
            {SUBMISSION_FILTERS.map((f) => (
              <button
                key={f.value}
                onClick={() => setSubmissionFilter(f.value)}
                className={`rounded-lg px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-wide transition-colors ${submissionFilter === f.value ? "bg-ink text-ink-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="space-y-2">
            {filteredSubmissions.length === 0 && (
              <p className="py-10 text-center text-sm text-muted-foreground">
                No submissions match this filter.
              </p>
            )}
            {filteredSubmissions.map((a) => (
              <Card key={a.id} className="shadow-card">
                <CardContent className="flex flex-wrap items-center justify-between gap-4 p-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-sm">{templateName(a.formId)}</p>
                      <StatusBadge status={a.status} />
                    </div>
                    <p className="font-mono text-xs text-muted-foreground mt-0.5">
                      Profile:{" "}
                      <Link
                        to="/clients/$clientId"
                        params={{ clientId: a.clientId }}
                        className="hover:text-primary font-medium"
                      >
                        {clientName(a.clientId)}
                      </Link>
                      {" · "}
                      {programOfTemplate(a.formId)}
                      {a.completionMethod && (
                        <>
                          {" "}
                          ·{" "}
                          <span className="capitalize">
                            {a.completionMethod.replace(/_/g, " ")}
                          </span>
                        </>
                      )}
                    </p>
                    <p className="font-mono text-xs text-muted-foreground">
                      {a.sentAt && <>Sent {new Date(a.sentAt).toLocaleDateString()} · </>}
                      {a.submittedAt && (
                        <>Submitted {new Date(a.submittedAt).toLocaleDateString()} · </>
                      )}
                      {a.dueDate && <>Due {new Date(a.dueDate).toLocaleDateString()}</>}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/clients/$clientId" params={{ clientId: a.clientId }}>
                      View profile
                    </Link>
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
