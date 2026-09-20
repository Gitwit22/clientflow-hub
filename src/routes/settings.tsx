import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { DemoDataRemovalDialog } from "@/components/dialogs/DemoDataRemovalDialog";
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
import { Crown, Eye, EyeOff, UserPlus, UserX } from "lucide-react";
import {
  ApiError,
  changePassword,
  cfSeedDemo,
  disableMember,
  enableMember,
  getOrganizationSettings,
  listMembers,
  revokeMemberInvite,
  updateProfile,
  updateMemberRole,
  updateOrganizationSettings,
} from "@/lib/apiClient";
import { useAppState } from "@/lib/store";
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
      <Badge
        variant="outline"
        className="shrink-0 border-[--color-ochre-tint] bg-ochre-tint font-mono text-[10px] uppercase tracking-wide text-warning"
      >
        Invited
      </Badge>
    );
  }
  if (!member.isActive) {
    return (
      <Badge
        variant="outline"
        className="shrink-0 bg-gray-tint font-mono text-[10px] uppercase tracking-wide text-muted-foreground"
      >
        Disabled
      </Badge>
    );
  }
  return (
    <Badge
      variant="outline"
      className="shrink-0 border-[--color-green-tint] bg-green-tint font-mono text-[10px] uppercase tracking-wide text-success"
    >
      Active
    </Badge>
  );
}

// ─── Settings page ────────────────────────────────────────────────────────────

function SettingsPage() {
  const { programs, formTemplates, authenticatedAdmin, retryBootstrap } = useAppState();
  const orgId = authenticatedAdmin?.organizationId ?? null;
  const selfId = authenticatedAdmin?.id ?? null;
  const canRemoveDemoPermanently =
    authenticatedAdmin?.role === "org_admin" || authenticatedAdmin?.role === "super_admin";

  // Users & Roles
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [roleUpdating, setRoleUpdating] = useState<string | null>(null);
  const [activeUpdating, setActiveUpdating] = useState<string | null>(null);
  const [inviteRevoking, setInviteRevoking] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);

  // Personal profile
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [jobTitle, setJobTitle] = useState("");
  const [profileSaving, setProfileSaving] = useState(false);

  // Security
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPasswords, setShowPasswords] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

  // Company profile
  const [orgLoading, setOrgLoading] = useState(false);
  const [companyName, setCompanyName] = useState("");
  const [replyTo, setReplyTo] = useState("");
  const [monitoringFreq, setMonitoringFreq] = useState("");
  const [orgSaving, setOrgSaving] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [demoRemovedAt, setDemoRemovedAt] = useState<string | null>(null);
  const [removeDemoOpen, setRemoveDemoOpen] = useState(false);
  const [demoSeeding, setDemoSeeding] = useState(false);

  // Templates card (local toggles)
  const [templateToggles, setTemplateToggles] = useState({
    programInvite: true,
    monitoringReminder: true,
    contractDraft: true,
    finalReport: true,
  });
  const [templateSaving, setTemplateSaving] = useState<string | null>(null);

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
      setTemplateToggles((current) => ({
        ...current,
        ...data.settings.notificationTemplateToggles,
      }));
      setLiveMode(data.liveMode);
      setDemoRemovedAt(data.demoRemovedAt ?? null);
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

  useEffect(() => {
    setFirstName(authenticatedAdmin?.firstName ?? "");
    setLastName(authenticatedAdmin?.lastName ?? "");
    setJobTitle(authenticatedAdmin?.jobTitle ?? "");
  }, [authenticatedAdmin]);

  async function handleSavePersonalProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setProfileSaving(true);
    try {
      const admin = await updateProfile({ firstName, lastName, jobTitle });
      setMembers((current) =>
        current.map((member) =>
          member.id === admin.id
            ? {
                ...member,
                firstName: admin.firstName,
                lastName: admin.lastName,
                jobTitle: admin.jobTitle,
              }
            : member,
        ),
      );
      toast.success("Personal profile saved.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to save personal profile.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleChangePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (newPassword !== confirmPassword) {
      toast.error("New passwords do not match.");
      return;
    }
    if (newPassword.length < 8) {
      toast.error("New password must be at least 8 characters.");
      return;
    }

    setPasswordSaving(true);
    try {
      const result = await changePassword({ currentPassword, newPassword });
      toast.success(result.message);
      window.location.assign("/login");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to change password.");
      setPasswordSaving(false);
    }
  }

  async function handleSeedDemo() {
    if (!window.confirm("Create server-persisted sample data for this organization?")) return;
    setDemoSeeding(true);
    try {
      const result = await cfSeedDemo();
      setLiveMode(result.liveMode);
      setDemoRemovedAt(null);
      retryBootstrap();
      toast.success("Demo data created.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to create demo data.");
    } finally {
      setDemoSeeding(false);
    }
  }

  // ── Role change ──────────────────────────────────────────────────────────────

  async function handleRoleChange(member: OrgMember, displayRole: DisplayRole) {
    if (!orgId) return;
    setRoleUpdating(member.id);
    try {
      const backendRole = toBackendRole(displayRole);
      await updateMemberRole(orgId, member.id, backendRole);
      setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, role: backendRole } : m)));
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
        setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, isActive: false } : m)));
        toast.success(`${memberName(member)} disabled.`);
      } else {
        await enableMember(orgId, member.id);
        setMembers((prev) => prev.map((m) => (m.id === member.id ? { ...m, isActive: true } : m)));
        toast.success(`${memberName(member)} enabled.`);
      }
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to update member status.");
    } finally {
      setActiveUpdating(null);
    }
  }

  async function handleRevokeInvite(member: OrgMember) {
    if (!orgId || !window.confirm(`Revoke the invitation to ${member.email}?`)) return;
    setInviteRevoking(member.id);
    try {
      const result = await revokeMemberInvite(orgId, member.id);
      setMembers((current) => current.filter((candidate) => candidate.id !== member.id));
      toast.success(result.message);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Failed to revoke invitation.");
    } finally {
      setInviteRevoking(null);
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

  async function handleTemplateToggle(
    key: keyof typeof templateToggles,
    enabled: boolean,
  ) {
    if (!orgId) return;
    const previous = templateToggles[key];
    setTemplateToggles((current) => ({ ...current, [key]: enabled }));
    setTemplateSaving(key);
    try {
      const updated = await updateOrganizationSettings(orgId, {
        notificationTemplateToggles: { [key]: enabled },
      });
      setTemplateToggles((current) => ({
        ...current,
        ...updated.settings.notificationTemplateToggles,
      }));
    } catch (error) {
      setTemplateToggles((current) => ({ ...current, [key]: previous }));
      toast.error(error instanceof ApiError ? error.message : "Failed to save template setting.");
    } finally {
      setTemplateSaving(null);
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
                const controlsLocked = isSelf || member.isPrincipal;
                const currentDisplay = toDisplayRole(member.role);
                return (
                  <div
                    key={member.id}
                    className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-1.5 truncate font-medium leading-tight">
                        {memberName(member)}
                        {isSelf && (
                          <Badge variant="secondary" className="shrink-0 text-[10px] uppercase">
                            You
                          </Badge>
                        )}
                        {member.isPrincipal && (
                          <Badge variant="outline" className="gap-1 text-[10px] uppercase">
                            <Crown className="size-3" /> Principal
                          </Badge>
                        )}
                      </p>
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {[member.jobTitle, member.email].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                    <MemberStatusBadge member={member} />
                    <Select
                      value={currentDisplay}
                      onValueChange={(v) => handleRoleChange(member, v as DisplayRole)}
                      disabled={controlsLocked || roleUpdating === member.id}
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
                    {member.invitePending ? (
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        className="size-7 shrink-0 text-destructive hover:text-destructive"
                        onClick={() => void handleRevokeInvite(member)}
                        disabled={inviteRevoking === member.id}
                        aria-label={`Revoke invitation to ${member.email}`}
                        title="Revoke invitation"
                      >
                        <UserX className="size-4" />
                      </Button>
                    ) : (
                      <Switch
                        checked={member.isActive}
                        onCheckedChange={() => handleToggleActive(member)}
                        disabled={controlsLocked || activeUpdating === member.id}
                        aria-label={member.isActive ? "Disable member" : "Enable member"}
                      />
                    )}
                  </div>
                );
              })
            )}
          </CardContent>
        </Card>

        {/* ── Personal profile ──────────────────────────────────────────────── */}
        <Card className="shadow-card">
          <CardHeader>
            <CardTitle className="font-display text-base">Personal profile</CardTitle>
          </CardHeader>
          <form onSubmit={handleSavePersonalProfile}>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="s-first-name">First name</Label>
                  <Input
                    id="s-first-name"
                    value={firstName}
                    onChange={(event) => setFirstName(event.target.value)}
                    maxLength={100}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="s-last-name">Last name</Label>
                  <Input
                    id="s-last-name"
                    value={lastName}
                    onChange={(event) => setLastName(event.target.value)}
                    maxLength={100}
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-profile-email">Email</Label>
                <Input
                  id="s-profile-email"
                  type="email"
                  value={authenticatedAdmin?.email ?? ""}
                  disabled
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="s-job-title">Job title</Label>
                <Input
                  id="s-job-title"
                  value={jobTitle}
                  onChange={(event) => setJobTitle(event.target.value)}
                  placeholder="Program manager"
                  maxLength={150}
                />
              </div>
            </CardContent>
            <CardFooter className="pt-0">
              <Button type="submit" size="sm" disabled={profileSaving || !authenticatedAdmin}>
                {profileSaving ? "Saving…" : "Save profile"}
              </Button>
            </CardFooter>
          </form>
        </Card>

        {/* ── Security ─────────────────────────────────────────────────────── */}
        <Card className="shadow-card">
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="font-display text-base">Security</CardTitle>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              onClick={() => setShowPasswords((visible) => !visible)}
              aria-label={showPasswords ? "Hide passwords" : "Show passwords"}
              title={showPasswords ? "Hide passwords" : "Show passwords"}
            >
              {showPasswords ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
            </Button>
          </CardHeader>
          <form onSubmit={handleChangePassword}>
            <CardContent className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="s-current-password">Current password</Label>
                <Input
                  id="s-current-password"
                  type={showPasswords ? "text" : "password"}
                  value={currentPassword}
                  onChange={(event) => setCurrentPassword(event.target.value)}
                  autoComplete="current-password"
                  minLength={8}
                  maxLength={72}
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="s-new-password">New password</Label>
                  <Input
                    id="s-new-password"
                    type={showPasswords ? "text" : "password"}
                    value={newPassword}
                    onChange={(event) => setNewPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={72}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="s-confirm-password">Confirm password</Label>
                  <Input
                    id="s-confirm-password"
                    type={showPasswords ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(event) => setConfirmPassword(event.target.value)}
                    autoComplete="new-password"
                    minLength={8}
                    maxLength={72}
                    required
                  />
                </div>
              </div>
            </CardContent>
            <CardFooter className="pt-0">
              <Button
                type="submit"
                size="sm"
                disabled={
                  passwordSaving || !currentPassword || !newPassword || !confirmPassword
                }
              >
                {passwordSaving ? "Changing…" : "Change password"}
              </Button>
            </CardFooter>
          </form>
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
                  disabled={!orgId || templateSaving !== null}
                  onCheckedChange={(value) => void handleTemplateToggle(key, value)}
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
            <p className="text-muted-foreground">
              Sample clients, form assignments, monitoring items, contracts, documents,
              communications and activity logs are loaded by default so you can explore the app.
              Programs and form templates are kept. You can remove the sample clients permanently —
              they will no longer appear after any login.
            </p>
            {!liveMode && canRemoveDemoPermanently ? (
              <Button variant="destructive" size="sm" onClick={() => setRemoveDemoOpen(true)}>
                Remove demo data permanently
              </Button>
            ) : liveMode && canRemoveDemoPermanently ? (
              <Button size="sm" disabled={demoSeeding} onClick={() => void handleSeedDemo()}>
                {demoSeeding ? "Creating demo data..." : "Create demo data"}
              </Button>
            ) : (
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
                {liveMode
                  ? `Demo data permanently removed${demoRemovedAt ? ` ${new Date(demoRemovedAt).toLocaleDateString()}` : ""}`
                    : "Only organization administrators can permanently remove demo data"}
              </p>
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

      <DemoDataRemovalDialog
        open={removeDemoOpen}
        onOpenChange={setRemoveDemoOpen}
        onPermanentSuccess={(result) => {
          setLiveMode(result.liveMode);
          setDemoRemovedAt(result.demoRemovedAt);
        }}
      />
    </div>
  );
}
