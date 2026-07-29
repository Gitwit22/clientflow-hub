import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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
      { name: "description", content: "Form template manager with program-specific question sets and email messaging." },
      { property: "og:title", content: "Forms — ClientFlow" },
      { property: "og:description", content: "Form template manager with program-specific question sets and email messaging." },
    ],
  }),
  component: FormsPage,
});

function FormsPage() {
  const { formTemplates, programs } = useAppState();
  const [openId, setOpenId] = useState<string | null>(formTemplates[0]?.id ?? null);
  return (
    <div className="space-y-6">
      <PageHeader title="Forms" description="Structured templates sent by secure link and prefilled from the client profile." />
      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <div className="space-y-2">
          {formTemplates.map((t) => (
            <button key={t.id} onClick={() => setOpenId(t.id)}
              className={`w-full rounded-xl border p-4 text-left transition-colors ${openId === t.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"}`}>
              <p className="text-sm font-semibold">{t.name}</p>
              <p className="mt-1 text-xs text-muted-foreground">{programs.find((p) => p.id === t.programId)?.name}</p>
            </button>
          ))}
        </div>
        {formTemplates.filter((t) => t.id === openId).map((t) => (
          <Card key={t.id} className="shadow-card"><CardContent className="space-y-5 p-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div><h2 className="font-display text-lg font-semibold">{t.name}</h2>
                <p className="text-sm text-muted-foreground">{t.description}</p></div>
              <StatusBadge status={t.isActive ? "Active" : "Draft"} />
            </div>
            <div>
              <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">Questions</p>
              <ul className="mt-2 divide-y divide-border rounded-xl border border-border">
                {t.fields.map((f) => (
                  <li key={f.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span>{f.label}</span>
                    <span className="text-xs text-muted-foreground">{f.type}{f.required ? " · required" : " · optional"}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div><p className="text-xs font-semibold text-muted-foreground uppercase">Due date setting</p><p className="text-sm">{t.dueInDays} days after send</p></div>
              <div><p className="text-xs font-semibold text-muted-foreground uppercase">Internal notes</p><p className="text-sm">{t.internalNotes ?? "—"}</p></div>
            </div>
            <div>
              <p className="text-xs font-semibold text-muted-foreground uppercase">Email message template</p>
              <pre className="mt-2 rounded-xl bg-muted p-4 font-sans text-sm whitespace-pre-wrap text-muted-foreground">{emailTemplateBody}</pre>
            </div>
            <Button variant="outline">Edit template</Button>
          </CardContent></Card>
        ))}
      </div>
    </div>
  );
}
