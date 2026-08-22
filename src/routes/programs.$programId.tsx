import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Pencil, Plus, Search, UserMinus, Users } from "lucide-react";
import { AddEditProgramDialog } from "@/components/dialogs/AddEditProgramDialog";
import { ManageProgramMembersDialog } from "@/components/dialogs/ManageProgramMembersDialog";
import { PageHeader } from "@/components/PageHeader";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { withdrawEnrollment } from "@/lib/api";
import { useAppState } from "@/lib/store";
import { toast } from "sonner";
import type { ProgramEnrollment } from "@/types";

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
  const program = state.programs.find((candidate) => candidate.id === programId);
  const [editOpen, setEditOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [memberQuery, setMemberQuery] = useState("");
  const [withdrawing, setWithdrawing] = useState<ProgramEnrollment | null>(null);
  const [withdrawReason, setWithdrawReason] = useState("");
  const [savingWithdrawal, setSavingWithdrawal] = useState(false);

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

  const enrollments = state.enrollments.filter(
    (enrollment) => enrollment.programId === program.id && !enrollment.isArchived,
  );
  const currentEnrollments = enrollments.filter(
    (enrollment) => !PAST_STATUSES.has(enrollment.status),
  );
  const pastEnrollments = enrollments.filter((enrollment) => PAST_STATUSES.has(enrollment.status));
  const programTemplates = state.formTemplates.filter(
    (template) => template.programId === program.id,
  );

  const MemberList = ({ past = false }: { past?: boolean }) => {
    const normalizedQuery = memberQuery.trim().toLowerCase();
    const records = (past ? pastEnrollments : currentEnrollments).filter((enrollment) => {
      if (!normalizedQuery) return true;
      const client = state.clients.find((candidate) => candidate.id === enrollment.clientId);
      return [client?.businessName, client?.primaryContactName, client?.email, enrollment.status]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedQuery));
    });
    if (records.length === 0) {
      return (
        <p className="py-8 text-center text-sm text-muted-foreground">
          {past ? "No past memberships." : "No current members in this program."}
        </p>
      );
    }

    return (
      <div className="divide-y divide-border">
        {records.map((enrollment) => {
          const client = state.clients.find((candidate) => candidate.id === enrollment.clientId);
          return (
            <div
              key={enrollment.id}
              className="grid gap-4 py-4 md:grid-cols-[minmax(0,1fr)_auto_10rem_auto] md:items-center"
            >
              <div className="min-w-0">
                {client ? (
                  <Link
                    to="/clients/$clientId"
                    params={{ clientId: client.id }}
                    search={{ programId: program.id, tab: "program" }}
                    className="font-medium hover:text-primary"
                  >
                    {client.businessName}
                  </Link>
                ) : (
                  <p className="font-medium">Unavailable client</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {client?.primaryContactName ?? enrollment.clientId} · Assigned to{" "}
                  {enrollment.assignedStaff || "Unassigned"}
                </p>
                {enrollment.nextAction && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Next: {enrollment.nextAction}
                    {enrollment.nextActionDate
                      ? ` · ${new Date(enrollment.nextActionDate).toLocaleDateString()}`
                      : ""}
                  </p>
                )}
              </div>
              <StatusBadge status={enrollment.status} />
              <div>
                <div className="flex justify-between font-mono text-[10px] uppercase text-muted-foreground">
                  <span>Progress</span>
                  <span>{enrollment.progressPercentage}%</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full bg-primary"
                    style={{
                      width: `${Math.min(100, Math.max(0, enrollment.progressPercentage))}%`,
                    }}
                  />
                </div>
              </div>
              {!past && (
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Withdraw ${client?.businessName ?? "client"} from program`}
                  onClick={() => {
                    setWithdrawReason("");
                    setWithdrawing(enrollment);
                  }}
                >
                  <UserMinus className="h-4 w-4" />
                </Button>
              )}
            </div>
          );
        })}
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
          {currentEnrollments.length} current member{currentEnrollments.length === 1 ? "" : "s"}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          {pastEnrollments.length} past member{pastEnrollments.length === 1 ? "" : "s"}
        </span>
      </div>

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="members">Members ({currentEnrollments.length})</TabsTrigger>
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
                <p className="font-display text-2xl font-semibold">{currentEnrollments.length}</p>
                <p className="text-xs text-muted-foreground">Current</p>
              </div>
              <div>
                <p className="font-display text-2xl font-semibold">
                  {enrollments.filter((item) => item.status === "completed").length}
                </p>
                <p className="text-xs text-muted-foreground">Completed</p>
              </div>
              <div>
                <p className="font-display text-2xl font-semibold">
                  {enrollments.filter((item) => ["declined", "withdrawn"].includes(item.status)).length}
                </p>
                <p className="text-xs text-muted-foreground">Closed</p>
              </div>
            </CardContent>
          </Card>
          <Card className="shadow-card lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display text-base">Workflow</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4 text-sm">
              <div>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">Default workflow</p>
                <p>{program.defaultWorkflow.join(" → ") || "No workflow configured"}</p>
              </div>
              <div>
                <p className="font-mono text-[10px] uppercase text-muted-foreground">Status pipeline</p>
                <p>{program.statusPipeline.join(" → ") || "No status pipeline configured"}</p>
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
          {pastEnrollments.length > 0 && (
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