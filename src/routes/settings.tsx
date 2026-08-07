import { createFileRoute } from "@tanstack/react-router";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatusBadge } from "@/components/StatusBadge";
import { CLIENT_STATUSES, STAFF } from "@/types";
import { useAppState } from "@/lib/store";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "Settings — ClientFlow" },
      {
        name: "description",
        content: "Users, roles, programs, statuses, forms, email and contract templates.",
      },
      { property: "og:title", content: "Settings — ClientFlow" },
      {
        property: "og:description",
        content: "Users, roles, programs, statuses, forms, email and contract templates.",
      },
    ],
  }),
  component: SettingsPage,
});

const ROLES = ["Admin", "Manager", "Staff", "Viewer"];

function SettingsPage() {
  const { programs, formTemplates } = useAppState();
  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configuration for users, programs, workflow statuses and templates."
      />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Users & roles</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {STAFF.map((s, i) => (
              <div
                key={s}
                className="flex items-center justify-between rounded-lg border border-border px-4 py-2.5 text-sm"
              >
                <span>{s}</span>
                <span className="text-muted-foreground">{ROLES[i % ROLES.length]}</span>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              Permissions are planned per role; enforcement arrives with the backend.
            </p>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Company profile</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label>Company name</Label>
              <Input defaultValue="EA Management" />
            </div>
            <div className="space-y-1.5">
              <Label>Reply-to email</Label>
              <Input defaultValue="programs@eamanagement.org" />
            </div>
            <div className="space-y-1.5">
              <Label>Default monitoring frequency</Label>
              <Input defaultValue="Monthly" />
            </div>
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Status settings</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {CLIENT_STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Program & form settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {programs.map((p) => (
              <div
                key={p.id}
                className="flex justify-between rounded-lg border border-border px-4 py-2.5"
              >
                <span>{p.name}</span>
                <span className="text-muted-foreground">
                  {formTemplates.find((f) => f.id === p.defaultFormTemplateId)?.name}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card className="shadow-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-base">Email & contract templates</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
            <div className="rounded-lg border border-border p-4">
              Program form invitation email · Active
            </div>
            <div className="rounded-lg border border-border p-4">
              Monitoring reminder email · Active
            </div>
            <div className="rounded-lg border border-border p-4">
              Service / Grant / Loan agreement templates
            </div>
            <div className="rounded-lg border border-border p-4">
              Sponsorship & event agreement templates
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
