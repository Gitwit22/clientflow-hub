import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Plus, RefreshCw, Search, Users } from "lucide-react";
import { AddEditProgramDialog } from "@/components/dialogs/AddEditProgramDialog";
import { ManageProgramMembersDialog } from "@/components/dialogs/ManageProgramMembersDialog";
import { PageHeader } from "@/components/PageHeader";
import { ProgramParticipantRow } from "@/components/programs/ProgramParticipantRow";
import { StatusBadge } from "@/components/StatusBadge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { resolveMemberName, useOrganizationMembers } from "@/hooks/use-organization-members";
import {
  createProgramWorkflowContractTemplate,
  createProgramWorkflowContractVersion,
  createProgramWorkflowWelcomeTemplate,
  createProgramWorkflowWelcomeVersion,
  getProgramDetail,
  updateProgramWorkflow,
  uploadStoredFile,
  withdrawEnrollment,
} from "@/lib/api";
import { useAppState } from "@/lib/store";
import { toast } from "sonner";
import type { ProgramDetailResponse, ProgramEnrollment } from "@/types";

export const Route = createFileRoute("/programs/$programId")({
  head: () => ({
    meta: [
      { title: "Program details - ClientFlow" },
      { name: "description", content: "Review program setup, members, and progress." },
    ],
  }),
  component: ProgramDetailPage,
});

const PAST_STATUSES = new Set(["completed", "declined", "withdrawn"]);

function ProgramDetailPage() {
  const { programId } = Route.useParams();
  const state = useAppState();
  const { members } = useOrganizationMembers();
  const [detail, setDetail] = useState<ProgramDetailResponse | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(true);
  const [refreshVersion, setRefreshVersion] = useState(0);
  const [expandedEnrollmentId, setExpandedEnrollmentId] = useState<string | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [withdrawing, setWithdrawing] = useState<ProgramEnrollment | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [savingWithdrawal, setSavingWithdrawal] = useState(false);
  const [savingWorkflow, setSavingWorkflow] = useState(false);
  const [contractTitle, setContractTitle] = useState("");
  const [contractContent, setContractContent] = useState("");
  const [contractFile, setContractFile] = useState<File | null>(null);
  const [welcomeSubject, setWelcomeSubject] = useState("");
  const [welcomeBody, setWelcomeBody] = useState("");
  const [welcomeGuideFile, setWelcomeGuideFile] = useState<File | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingDetail(true);
    setDetailError(null);
    void getProgramDetail(programId)
      .then((response) => {
        if (!cancelled) setDetail(response);
      })
      .catch((error: unknown) => {
        if (!cancelled) {
          setDetailError(error instanceof Error ? error.message : "Unable to load program details.");
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingDetail(false);
      });
    return () => {
      cancelled = true;
    };
  }, [programId, refreshVersion]);

  const program = detail?.program ?? state.programs.find((candidate) => candidate.id === programId);

  if (loadingDetail && !detail) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/programs"><ArrowLeft className="mr-2 h-4 w-4" />Programs</Link>
        </Button>
        <Card className="shadow-card"><CardContent className="py-12 text-center text-sm text-muted-foreground">Loading program details...</CardContent></Card>
      </div>
    );
  }

  if (detailError && !detail) {
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/programs"><ArrowLeft className="mr-2 h-4 w-4" />Programs</Link>
        </Button>
        <Card className="shadow-card">
          <CardContent className="py-10 text-center">
            <p className="text-sm text-destructive">{detailError}</p>
            <Button className="mt-4" variant="outline" onClick={() => setRefreshVersion((value) => value + 1)}>
              <RefreshCw className="mr-2 h-4 w-4" />Retry
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!program) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">Program not found.</p>
        <Button variant="outline" asChild>
          <Link to="/programs">
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to programs
          </Link>
        </Button>
      </div>
    );
  }

  const participants = detail?.participants ?? [];
  const currentParticipants = participants.filter(
    ({ enrollment }) => !PAST_STATUSES.has(enrollment.status),
  );
  const pastParticipants = participants.filter(({ enrollment }) => PAST_STATUSES.has(enrollment.status));
  const summary = {
    current: detail?.summary?.current ?? currentParticipants.length,
    completed: detail?.summary?.completed ?? 0,
    closed: detail?.summary?.closed ?? 0,
  };
  const programTemplates = state.formTemplates.filter(
    (template) => template.programId === program.id,
  );
  const workflow = detail?.workflow;

  const MemberList = ({ past = false }: { past?: boolean }) => {
    const normalizedQuery = memberQuery.trim().toLowerCase();
    const records = (past ? pastParticipants : currentParticipants).filter((participant) => {
      if (!normalizedQuery) return true;
      return [
        participant.client.businessName,
        participant.client.primaryContactName,
        participant.client.email,
        participant.enrollment.status,
      ]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(normalizedQuery));
    });
    if (records.length === 0) {
      return (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {past ? "No past memberships." : "No current members in this program."}
        </p>
      );
    }

    return (
      <div>
        {records.map((participant) => (
          <ProgramParticipantRow
            key={participant.enrollment.id}
            participant={{
              ...participant,
              statusHistory: (participant.statusHistory ?? []).map((item) => ({
                ...item,
                changedByDisplayName: resolveMemberName(
                  members,
                  item.changedByUserId,
                  item.changedByDisplayName || "Unknown user",
                ),
              })),
            }}
            assignedStaffName={resolveMemberName(
              members,
              participant.enrollment.assignedUserId,
              participant.enrollment.assignedStaff || "Unassigned",
            )}
            lastModifiedByName={resolveMemberName(
              members,
              participant.enrollment.lastModifiedByUserId,
              participant.enrollment.lastModifiedByDisplayName || "Unknown user",
            )}
            open={expandedEnrollmentId === participant.enrollment.id}
            onOpenChange={(open) => setExpandedEnrollmentId(open ? participant.enrollment.id : null)}
            canWithdraw={!past}
            onWithdraw={() => {
              setWithdrawReason("");
              setWithdrawing(participant.enrollment);
            }}
          />
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <Button variant="ghost" size="sm" asChild>
        <Link to="/programs">
          <ArrowLeft className="mr-2 h-4 w-4" />
          Programs
        </Link>
      </Button>

      <PageHeader
        eyebrow="Program"
        title={program.name}
        description={program.description}
        actions={
          <>
            <Button
              onClick={() => setMembersOpen(true)}
              disabled={!program.isActive}
              title={program.isActive ? "Add program members" : "Activate the program to add members"}
            >
              <Plus className="mr-2 h-4 w-4" />
              Add members
            </Button>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="mr-2 h-4 w-4" />
              Edit program
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={program.isActive ? "Active" : "Inactive"} />
        <span className="font-mono text-xs text-muted-foreground">
          {summary.current} current member{summary.current === 1 ? "" : "s"}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {summary.completed + summary.closed} past member{(summary.completed + summary.closed) === 1 ? "" : "s"}
        </span>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members ({summary.current})</TabsTrigger>
          <TabsTrigger value="questions">Program questions</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-base">Program setup</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
              <div>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">Default form</p>
                <p>{state.formTemplates.find((item) => item.id === program.defaultFormTemplateId)?.name ?? "None"}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">Contract</p>
                <p>{program.defaultContractTemplateId}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">Monitoring</p>
                <p>{program.defaultMonitoringFrequency}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">Documents</p>
                <p>{program.requiredDocuments.join(", ") || "None"}</p>
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-base">At a glance</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="font-display text-2xl font-semibold">{summary.current}</p>
                <p className="text-xs text-muted-foreground">Current</p>
              </div>
              <div>
                <p className="font-display text-2xl font-semibold">
                  {summary.completed}
                </p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
              <div>
                <p className="font-display text-2xl font-semibold">
                  {summary.closed}
                </p>
                <p className="text-xs text-muted-foreground">Closed</p>
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-card lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display text-base">Program workflow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div className="space-y-1">
                <p className="font-mono text-[10px] uppercase text-muted-foreground">1. Intake</p>
                <p>{state.formTemplates.find((item) => item.id === program.defaultFormTemplateId)?.name ?? "No intake form configured"}</p>
              </div>
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="font-mono text-[10px] uppercase text-muted-foreground">2. Contract</p>
                <p>
                  {workflow?.contract.activeVersion?.title
                    ?? workflow?.contract.activeTemplate?.name
                    ?? "No active contract template"}
                </p>
                <p className="text-xs text-muted-foreground">
                  Signature required: {workflow?.contract.activeTemplate?.signatureRequired ? "Yes" : "No"}
                </p>
              </div>
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="font-mono text-[10px] uppercase text-muted-foreground">3. Welcome email</p>
                <p>{workflow?.welcomeEmail.activeVersion?.subject || "No active welcome email template"}</p>
                <p className="text-xs text-muted-foreground line-clamp-2">
                  {workflow?.welcomeEmail.activeVersion?.body || "Add a welcome email version to enable post-signature messaging."}
                </p>
              </div>
              <div className="space-y-2 rounded-lg border border-border p-3">
                <p className="font-mono text-[10px] uppercase text-muted-foreground">4. Automation</p>
                <div className="flex items-center justify-between gap-2">
                  <span>Send contract after intake submission</span>
                  <Switch
                    checked={workflow?.automation.sendContractAfterIntake ?? false}
                    disabled={savingWorkflow || !workflow}
                    onCheckedChange={(checked) => {
                      if (!workflow) return;
                      setSavingWorkflow(true);
                      void updateProgramWorkflow(program.id, { sendContractAfterIntake: checked })
                        .then(() => setRefreshVersion((value) => value + 1))
                        .catch((error: unknown) => {
                          toast.error(error instanceof Error ? error.message : "Unable to update workflow.");
                        })
                        .finally(() => setSavingWorkflow(false));
                    }}
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <span>Send welcome email after contract signing</span>
                  <Switch
                    checked={workflow?.automation.sendWelcomeAfterContractSigned ?? false}
                    disabled={savingWorkflow || !workflow}
                    onCheckedChange={(checked) => {
                      if (!workflow) return;
                      setSavingWorkflow(true);
                      void updateProgramWorkflow(program.id, { sendWelcomeAfterContractSigned: checked })
                        .then(() => setRefreshVersion((value) => value + 1))
                        .catch((error: unknown) => {
                          toast.error(error instanceof Error ? error.message : "Unable to update workflow.");
                        })
                        .finally(() => setSavingWorkflow(false));
                    }}
                  />
                </div>
              </div>
              <div className="grid gap-4 lg:grid-cols-2">
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase text-muted-foreground">Contract versions</p>
                    <p className="text-xs text-muted-foreground">
                      Auto-contract uses the exact active version only.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {workflow?.contract.versions.filter((version) => version.templateId === workflow.contract.activeTemplate?.id).map((version) => (
                      <div key={version.id} className="flex items-center justify-between gap-2 rounded border border-border px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {version.title || `Version ${version.version}`}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            v{version.version}{version.storedFileId ? " · file attached" : ""}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant={workflow?.config.activeContractVersionId === version.id ? "default" : "outline"}
                          disabled={savingWorkflow}
                          onClick={() => {
                            setSavingWorkflow(true);
                            void updateProgramWorkflow(program.id, {
                              activeContractTemplateId: version.templateId,
                              activeContractVersionId: version.id,
                            })
                              .then(() => setRefreshVersion((value) => value + 1))
                              .catch((error: unknown) => {
                                toast.error(error instanceof Error ? error.message : "Unable to activate contract version.");
                              })
                              .finally(() => setSavingWorkflow(false));
                          }}
                        >
                          {workflow?.config.activeContractVersionId === version.id ? "Active" : "Activate"}
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Input
                    value={contractTitle}
                    onChange={(event) => setContractTitle(event.target.value)}
                    placeholder="Contract version title"
                  />
                  <Textarea
                    value={contractContent}
                    onChange={(event) => setContractContent(event.target.value)}
                    rows={8}
                    placeholder="Contract body"
                  />
                  <Input type="file" onChange={(event) => setContractFile(event.target.files?.[0] ?? null)} />
                  <Button
                    disabled={savingWorkflow || !contractContent.trim()}
                    onClick={() => {
                      setSavingWorkflow(true);
                      void (async () => {
                        let storedFileId: string | undefined;
                        if (contractFile) {
                          const storedFile = await uploadStoredFile(contractFile, "program-workflow/contracts");
                          storedFileId = storedFile.id;
                        }
                        if (workflow?.contract.activeTemplate) {
                          await createProgramWorkflowContractVersion(program.id, workflow.contract.activeTemplate.id, {
                            title: contractTitle.trim() || undefined,
                            content: contractContent.trim(),
                            storedFileId,
                            makeActive: true,
                          });
                        } else {
                          await createProgramWorkflowContractTemplate(program.id, {
                            name: `${program.name} Contract`,
                            title: contractTitle.trim() || `${program.name} Contract`,
                            content: contractContent.trim(),
                            storedFileId,
                            isActive: true,
                          });
                        }
                        setContractTitle("");
                        setContractContent("");
                        setContractFile(null);
                        setRefreshVersion((value) => value + 1);
                        toast.success("Contract workflow asset saved.");
                      })()
                        .catch((error: unknown) => {
                          toast.error(error instanceof Error ? error.message : "Unable to save contract workflow asset.");
                        })
                        .finally(() => setSavingWorkflow(false));
                    }}
                  >
                    Save contract version
                  </Button>
                </div>
                <div className="space-y-3 rounded-lg border border-border p-3">
                  <div>
                    <p className="font-mono text-[10px] uppercase text-muted-foreground">Welcome versions</p>
                    <p className="text-xs text-muted-foreground">
                      If no active custom version exists, ClientFlow falls back to the generic welcome body.
                    </p>
                  </div>
                  <div className="space-y-2">
                    {workflow?.welcomeEmail.versions.filter((version) => version.templateId === workflow.welcomeEmail.activeTemplate?.id).map((version) => (
                      <div key={version.id} className="flex items-center justify-between gap-2 rounded border border-border px-3 py-2">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{version.subject}</p>
                          <p className="text-xs text-muted-foreground">
                            v{version.version}{version.guideStoredFileId ? " · guide attached" : ""}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant={workflow?.config.activeWelcomeEmailVersionId === version.id ? "default" : "outline"}
                          disabled={savingWorkflow}
                          onClick={() => {
                            setSavingWorkflow(true);
                            void updateProgramWorkflow(program.id, {
                              activeWelcomeEmailTemplateId: version.templateId,
                              activeWelcomeEmailVersionId: version.id,
                            })
                              .then(() => setRefreshVersion((value) => value + 1))
                              .catch((error: unknown) => {
                                toast.error(error instanceof Error ? error.message : "Unable to activate welcome version.");
                              })
                              .finally(() => setSavingWorkflow(false));
                          }}
                        >
                          {workflow?.config.activeWelcomeEmailVersionId === version.id ? "Active" : "Activate"}
                        </Button>
                      </div>
                    ))}
                  </div>
                  <Input
                    value={welcomeSubject}
                    onChange={(event) => setWelcomeSubject(event.target.value)}
                    placeholder={`Welcome to ${program.name}`}
                  />
                  <Textarea
                    value={welcomeBody}
                    onChange={(event) => setWelcomeBody(event.target.value)}
                    rows={8}
                    placeholder="Welcome email body"
                  />
                  <Input type="file" onChange={(event) => setWelcomeGuideFile(event.target.files?.[0] ?? null)} />
                  <Button
                    disabled={savingWorkflow || !welcomeBody.trim()}
                    onClick={() => {
                      setSavingWorkflow(true);
                      void (async () => {
                        let guideStoredFileId: string | undefined;
                        if (welcomeGuideFile) {
                          const storedFile = await uploadStoredFile(welcomeGuideFile, "program-workflow/welcome-guides");
                          guideStoredFileId = storedFile.id;
                        }
                        if (workflow?.welcomeEmail.activeTemplate) {
                          await createProgramWorkflowWelcomeVersion(program.id, workflow.welcomeEmail.activeTemplate.id, {
                            subject: welcomeSubject.trim() || `Welcome to ${program.name}`,
                            body: welcomeBody.trim(),
                            guideStoredFileId,
                            makeActive: true,
                          });
                        } else {
                          await createProgramWorkflowWelcomeTemplate(program.id, {
                            name: `${program.name} Welcome`,
                            subject: welcomeSubject.trim() || `Welcome to ${program.name}`,
                            body: welcomeBody.trim(),
                            guideStoredFileId,
                            isActive: true,
                          });
                        }
                        setWelcomeSubject("");
                        setWelcomeBody("");
                        setWelcomeGuideFile(null);
                        setRefreshVersion((value) => value + 1);
                        toast.success("Welcome workflow asset saved.");
                      })()
                        .catch((error: unknown) => {
                          toast.error(error instanceof Error ? error.message : "Unable to save welcome workflow asset.");
                        })
                        .finally(() => setSavingWorkflow(false));
                    }}
                  >
                    Save welcome version
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="members" className="mt-4 space-y-4">
          <div className="relative max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={memberQuery}
              onChange={(event) => setMemberQuery(event.target.value)}
              placeholder="Search program members"
              className="pl-9"
            />
          </div>
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 font-display text-base">
                <Users className="h-4 w-4" /> Current members
              </CardTitle>
            </CardHeader>
            <CardContent>
              <MemberList />
            </CardContent>
          </Card>
          {pastParticipants.length > 0 && (
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-base">Past memberships</CardTitle>
              </CardHeader>
              <CardContent>
                <MemberList past />
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="questions" className="mt-4 space-y-4">
          {programTemplates.length === 0 ? (
            <Card className="shadow-card">
              <CardContent className="py-10 text-center text-sm text-muted-foreground">
                No program-specific forms are configured.
              </CardContent>
            </Card>
          ) : (
            programTemplates.map((template) => (
              <Card key={template.id} className="shadow-card">
                <CardHeader>
                  <CardTitle className="font-display text-base">{template.name}</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  <p className="text-sm text-muted-foreground">{template.description}</p>
                  <ol className="space-y-2">
                    {template.fields.map((field, index) => (
                      <li key={field.id} className="flex gap-3 border-b border-border py-2 last:border-0">
                        <span className="font-mono text-xs text-muted-foreground">{index + 1}</span>
                        <span className="text-sm">
                          {field.label}{field.required ? " *" : ""}
                        </span>
                      </li>
                    ))}
                  </ol>
                </CardContent>
              </Card>
            ))
          )}
        </TabsContent>
      </Tabs>

      <AddEditProgramDialog program={program} open={editOpen} onOpenChange={setEditOpen} />
      <ManageProgramMembersDialog
        program={program}
        open={membersOpen}
        onOpenChange={setMembersOpen}
      />
      <AlertDialog open={withdrawing !== null} onOpenChange={(open) => !open && setWithdrawing(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Withdraw this member?</AlertDialogTitle>
            <AlertDialogDescription>
              This preserves the enrollment and its history, but removes the client from current members.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <Textarea
            value={withdrawReason}
            onChange={(event) => setWithdrawReason(event.target.value)}
            placeholder="Reason for withdrawal"
            aria-label="Withdrawal reason"
          />
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingWithdrawal}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={!withdrawReason.trim() || savingWithdrawal}
              onClick={(event) => {
                event.preventDefault();
                if (!withdrawing || !withdrawReason.trim()) return;
                setSavingWithdrawal(true);
                void withdrawEnrollment(withdrawing.id, withdrawReason.trim())
                  .then(() => {
                    toast.success("Member withdrawn from program.");
                    setWithdrawing(null);
                    setExpandedEnrollmentId(null);
                    setRefreshVersion((value) => value + 1);
                  })
                  .catch((error: unknown) => {
                    toast.error(error instanceof Error ? error.message : "Unable to withdraw member.");
                  })
                  .finally(() => setSavingWithdrawal(false));
              }}
            >
              {savingWithdrawal ? "Withdrawing..." : "Withdraw member"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}