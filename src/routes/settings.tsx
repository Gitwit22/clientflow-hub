import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { StatusBadge } from "@/components/StatusBadge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { UserPlus } from "lucide-react";
import {
  ApiError,
  disableMember,
  enableMember,
  getOrganizationSettings,
  listMembers,
  updateMemberRole,
  updateOrganizationSettings,
} from "@/lib/apiClient";
import { useAppState, hideMockData } from "@/lib/store";
import { MOCK_IDS } from "@/data/mock";
import { cfRemoveDemo } from "@/lib/apiClient";
import { CLIENT_STATUSES } from "@/types";
import type { OrgMember, OrgSettings, BackendRole } from "@/types";
import { InviteUserDialog } from "@/components/dialogs/InviteUserDialog";

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

// ─── Role helpers ─────────────────────────────────────────────────────────────

const DISPLAY_ROLES = ["Admin", "Manager", "Staff", "Viewer"] as const;
type DisplayRole = (typeof DISPLAY_ROLES)[number];

function toBackendRole(label: DisplayRole): "org_admin" | "reviewer" {
  return label === "Admin" || label === "Manager" ? "org_admin" : "reviewer";
}

function toDisplayRole(role: BackendRole): DisplayRole {
  return role === "org_admin" || role === "super_admin" ? "Admin" : "Staff";
}

function memberName(m: OrgMember): string {
  const parts = [m.firstName, m.lastName].filter(Boolean).join(" ");
  return parts || m.email;
}

function MemberStatusBadge({ member }: { member: OrgMember }) {
  if (member.invitePending) {
    return (
      <Badge variant="outline" className="shrink-0 border-[--color-ochre-tint] bg-ochre-tint font-mono text-[10px] uppercase tracking-wide text-warning">
        Invited
      </Badge>
    );
  }
  if (!member.isActive) {
    return (
      <Badge variant="outline" className="shrink-0 bg-gray-tint font-mono text-[10px] uppercase tracking-wide text-muted-foreground">
        Disabled
      </Badge>
    );
  }
  return (
    <Badge variant="outline" className="shrink-0 border-[--color-green-tint] bg-green-tint font-mono text-[10px] uppercase tracking-wide text-success">
      Active
    </Badge>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────

function SettingsPage() {
  const { programs, formTemplates, authenticatedAdmin, mockHidden, clients } = useAppState();
  const hasMockData = !mockHidden && clients.some((c) => MOCK_IDS.clients.has(c.id));
  const orgId = authenticatedAdmin?.organizationId ?? null;
  const selfId = authenticatedAdmin?.id ?? null;

  // Users & Roles
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [roleUpdating, setRoleUpdating] = useState<string | null>(null);
  const [activeUpdating, setActiveUpdating] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  // Company profile
  const [orgLoading, setOrgLoading] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [monitoringFreq, setMonitoringFreq] = useState("");
  const [orgSaving, setOrgSaving] = useState(false);

  // Templates card (local toggles)
  const [templateToggles, setTemplateToggles] = useState({
    programInvite: true,
    monitoringReminder: true,
    contractDraft: true,
    finalReport: true,
  });

  // ── Fetch members ────────────────────────────────────────────────────────────

  async function fetchMembers() {
    if (!orgId) return;
    setMembersLoading(true);
    try {
      const data = await listMembers(orgId);
      setMembers(data);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to load team members.");
    } finally {
      setMembersLoading(false);
    }
  }

  // ── Fetch org settings ───────────────────────────────────────────────────────

  async function fetchOrgSettings() {
    if (!orgId) return;
    setOrgLoading(true);
    try {
      const data: OrgSettings = await getOrganizationSettings(orgId);
      setCompanyName(data.name ?? "");
      setReplyTo((data.settings.replyToEmail as string) ?? "");
      setMonitoringFreq((data.settings.defaultMonitoringFrequency as string) ?? "");
    } catch {
      // Non-fatal — org settings may not be seeded yet
    } finally {
      setOrgLoading(false);
    }
  }

  useEffect(() => {
    void fetchMembers();
    void fetchOrgSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // ── Role change ──────────────────────────────────────────────────────────────

  async function handleRoleChange(member: OrgMember, displayRole: DisplayRole) {
    if (!orgId) return;
    setRoleUpdating(member.id);
    try {
      const backendRole = toBackendRole(displayRole);
      await updateMemberRole(orgId, member.id, backendRole);
      setMembers((prev) =>
        prev.map((m) => (m.id === member.id ? { ...m, role: backendRole } : m)),
      );
      toast.success(`${memberName(member)}'s role updated.`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update role.");
    } finally {
      setRoleUpdating(null);
    }
  }

  // ── Disable / enable ─────────────────────────────────────────────────────────

  async function handleToggleActive(member: OrgMember) {
    if (!orgId) return;
    setActiveUpdating(member.id);
    try {
      if (member.isActive) {
        await disableMember(orgId, member.id);
        setMembers((prev) =>
          prev.map((m) => (m.id === member.id ? { ...m, isActive: false } : m)),
        );
        toast.success(`${memberName(member)} disabled.`);
      } else {
        await enableMember(orgId, member.id);
        setMembers((prev) =>
          prev.map((m) => (m.id === member.id ? { ...m, isActive: true } : m)),
        );
        toast.success(`${memberName(member)} enabled.`);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update member status.");
    } finally {
      setActiveUpdating(null);
    }
  }

  // ── Save company profile ─────────────────────────────────────────────────────

  async function handleSaveProfile(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!orgId) return;
    setOrgSaving(true);
    try {
      const updated = await updateOrganizationSettings(orgId, {
        name: companyName.trim() || undefined,
        replyToEmail: replyTo.trim() || undefined,
        defaultMonitoringFrequency: monitoringFreq.trim() || undefined,
      });
      setCompanyName(updated.name ?? "");
      toast.success("Company profile saved.");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to save profile.");
    } finally {
      setOrgSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Settings"
        description="Configuration for users, programs, workflow statuses and templates."
      />

      <div className="grid gap-4 lg:grid-cols-2">
        {/* ── Users & Roles ──────────────────────────────────────────────────── */}
        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardTitle className="font-display text-base">Users & roles</CardTitle>
            {orgId && (
              <Button size="sm" variant="outline" onClick={() => setInviteOpen(true)}>
                <UserPlus className="size-3.5 mr-1.5" />
                Invite
              </Button>
            )}
          </CardHeader>
          <CardContent className="space-y-2">
            {!orgId ? (
              <p className="text-sm text-muted-foreground">
                No organization found. Sign in with an admin account to manage users.
              </p>
            ) : membersLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-11 w-full rounded-lg" />
              ))
            ) : members.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No team members yet. Invite someone to get started.
              </p>
            ) : (
              members.map((member) => {
                const isSelf = member.id === selfId;
                const currentDisplay = toDisplayRole(member.role);
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium leading-tight">{memberName(member)}</p>
                      <p className="truncate font-mono text-xs text-muted-foreground">{member.email}</p>
                    </div>
                    <MemberStatusBadge member={member} />
                    <Select
                      value={currentDisplay}
                      onValueChange={(v) => handleRoleChange(member, v as DisplayRole)}
                      disabled={isSelf || roleUpdating === member.id}
                    >
                      <SelectTrigger className="h-7 w-28 text-xs shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {DISPLAY_ROLES.map((r) => (
                          <SelectItem key={r} value={r} className="text-xs">
                            {r}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Switch
                      checked={member.isActive}
                      onCheckedChange={() => handleToggleActive(member)}
                      disabled={isSelf || activeUpdating === member.id}
                      aria-label={member.isActive ? "Disable member" : "Enable member"}
                    />
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* ── Company profile ────────────────────────────────────────────────── */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Company profile</CardTitle>
          </CardHeader>
          <form onSubmit={handleSaveProfile}>
            <CardContent className="space-y-3">
              {orgLoading ? (
                <>
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                  <Skeleton className="h-9 w-full" />
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <Label htmlFor="s-company-name">Company name</Label>
                    <Input
                      id="s-company-name"
                      value={companyName}
                      onChange={(e) => setCompanyName(e.target.value)}
                      placeholder="Your organization name"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="s-reply-to">Reply-to email</Label>
                    <Input
                      id="s-reply-to"
                      type="email"
                      value={replyTo}
                      onChange={(e) => setReplyTo(e.target.value)}
                      placeholder="programs@example.org"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="s-monitoring">Default monitoring frequency</Label>
                    <Input
                      id="s-monitoring"
                      value={monitoringFreq}
                      onChange={(e) => setMonitoringFreq(e.target.value)}
                      placeholder="Monthly"
                    />
                  </div>
                </>
              )}
            </CardContent>
            <CardFooter className="pt-0">
              <Button type="submit" size="sm" disabled={orgSaving || orgLoading || !orgId}>
                {orgSaving ? "Saving…" : "Save"}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* ── Status settings ────────────────────────────────────────────────── */}
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

        {/* ── Program & form settings ────────────────────────────────────────── */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Program & form settings</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {programs.map((p) => (
              <div
                key={p.id}
                className="flex items-center justify-between gap-2 rounded-lg border border-border px-4 py-2.5"
              >
                <span className="font-medium truncate">{p.name}</span>
                <Select
                  value={p.defaultFormTemplateId ?? "__none"}
                  onValueChange={() => {
                    toast.info("Program template updates coming soon.");
                  }}
                >
                  <SelectTrigger className="h-7 w-44 text-xs shrink-0">
                    <SelectValue placeholder="No form" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none" className="text-xs text-muted-foreground">
                      No form
                    </SelectItem>
                    {formTemplates.map((f) => (
                      <SelectItem key={f.id} value={f.id} className="text-xs">
                        {f.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── Email & contract templates ─────────────────────────────────────── */}
        <Card className="shadow-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-base">Email & contract templates</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
            {(
              [
                { key: "programInvite" as const, label: "Program form invitation email" },
                { key: "monitoringReminder" as const, label: "Monitoring reminder email" },
                { key: "contractDraft" as const, label: "Contract draft template" },
                { key: "finalReport" as const, label: "Final report template" },
              ] as const
            ).map(({ key, label }) => (
              <div
                key={key}
                className="flex items-center justify-between rounded-lg border border-border p-4"
              >
                <div>
                  <p className="font-medium">{label}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Template content editing coming soon
                  </p>
                </div>
                <Switch
                  checked={templateToggles[key]}
                  onCheckedChange={(v) =>
                    setTemplateToggles((prev) => ({ ...prev, [key]: v }))
                  }
                  aria-label={`Toggle ${label}`}
                />
              </div>
            ))}
          </CardContent>
        </Card>

        {/* ── Demo data ─────────────────────────────────────────────────────── */}
        <Card className="shadow-card lg:col-span-2">
          <CardHeader>
            <CardTitle className="font-display text-base">Demo data</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-muted-foreground">Sample clients, form assignments, monitoring items, contracts, documents, communications and activity logs are loaded by default so you can explore the app. Programs and form templates are kept. You can remove the sample clients permanently — they will no longer appear after any login.</p>
            {hasMockData ? (
              <Button
                variant="destructive"
                size="sm"
                onClick={async () => {
                  await cfRemoveDemo({
                    clientIds: [...MOCK_IDS.clients],
                    programIds: [...MOCK_IDS.programs],
                    formTemplateIds: [...MOCK_IDS.formTemplates],
                    formAssignmentIds: [...MOCK_IDS.formAssignments],
                    termsIds: [...MOCK_IDS.terms],
                    monitoringIds: [...MOCK_IDS.monitoring],
                    contractIds: [...MOCK_IDS.contracts],
                    documentIds: [...MOCK_IDS.documents],
                    communicationIds: [...MOCK_IDS.communications],
                    finalReportIds: [...MOCK_IDS.finalReports],
                    activityIds: [...MOCK_IDS.activity],
                  }).catch(() => undefined);
                  hideMockData(true);
                }}
              >
                Remove demo data permanently
              </Button>
            ) : (
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Demo data removed for this org</p>
            )}
          </CardContent>
        </Card>
      </div>

      {orgId && (
        <InviteUserDialog
          open={inviteOpen}
          onOpenChange={setInviteOpen}
          organizationId={orgId}
          onSuccess={fetchMembers}
        />
      )}
    </div>
  );
}
