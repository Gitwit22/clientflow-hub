import { useEffect, useState, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Pencil } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { FormRendererDialog } from "@/components/dialogs/FormRendererDialog";
import { EditClientDialog } from "@/components/dialogs/EditClientDialog";
import { MergeResponsesDialog } from "@/components/dialogs/MergeResponsesDialog";
import { SendFormDialog } from "@/components/dialogs/SendFormDialog";
import { TermsDialog } from "@/components/dialogs/TermsDialog";
import { useAppState } from "@/lib/store";
import {
  addCommunication,
  archiveClient,
  cancelFormAssignment,
  createEnrollmentMonitoring,
  createFinalReport,
  downloadDocument,
  generateContract,
  refreshClientProfile,
  recordMonitoringResult,
  updateClient,
  updateContract,
  uploadDocument,
} from "@/lib/api";
import {
  ARCHIVE_DECISIONS,
  type FormAssignment,
  type IntakeDetails,
  type IntakeSubmission,
} from "@/types";

const MONITORING_TYPES = [
  "Payment check",
  "Milestone check",
  "Progress report",
  "Document request",
  "Follow-up meeting",
  "Grant compliance",
  "Sponsorship benefit fulfillment",
  "Contract review",
];

export const Route = createFileRoute("/clients/$clientId")({
  validateSearch: (search: Record<string, unknown>) => ({
    programId: typeof search.programId === "string" ? search.programId : undefined,
    tab: search.tab === "program" ? ("program" as const) : undefined,
  }),
  head: () => ({
    meta: [
      { title: "Client profile — ClientFlow" },
      {
        name: "description",
        content:
          "Full client profile: intake, forms, terms, monitoring, documents, contracts and final report.",
      },
      { property: "og:title", content: "Client profile — ClientFlow" },
      {
        property: "og:description",
        content:
          "Full client profile: intake, forms, terms, monitoring, documents, contracts and final report.",
      },
    ],
  }),
  component: ClientProfile,
});

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="border-b border-border py-2 last:border-0">
      <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm">{value || "—"}</dd>
    </div>
  );
}

function displayAnswer(value: unknown): string {
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value : "";
}

const PROFILE_FIELD_IDS = new Set([
  "name",
  "primaryContactName",
  "fullName",
  "applicant",
  "business",
  "businessName",
  "email",
  "phone",
  "website",
  "socialLinks",
  "facebookUrl",
  "instagramUrl",
  "linkedinUrl",
  "tiktokUrl",
  "youtubeUrl",
]);

function submittedCoreFields(
  submission: IntakeSubmission | undefined,
) {
  const coreSection = submission?.snapshot?.renderedSections.find(
    (section) => section.kind === "core",
  );
  if (!coreSection) return null;

  return coreSection.fields
    .filter(
      (field) => !PROFILE_FIELD_IDS.has(field.id) && !PROFILE_FIELD_IDS.has(field.prefillKey ?? ""),
    )
    .map((field) => ({
      field,
      value: displayAnswer(submission.responsePayload[field.id]),
    }));
}

// Mirrors nxt-lvl-api2's INTAKE_FIELD_KEYS/TOP_LEVEL_FIELD_KEYS so we can tell whether a
// mapped client.intake value still corresponds to a field on the form that was actually sent.
const INTAKE_KEY_ALIASES: Record<
  Exclude<keyof IntakeDetails, "uploadedFiles">,
  string[]
> = {
  businessDescription: ["businessdescription", "description"],
  businessType: ["businesstype", "biztype", "industry"],
  assistanceRequested: ["assistancerequested", "assistance"],
  programOfInterest: ["programofinterest", "program"],
  budgetNeed: ["budgetneed", "budget"],
  preferredContact: ["preferredcontact", "contact_pref", "contact"],
  heardAboutUs: ["heardaboutus", "heard"],
  additionalComments: ["additionalcomments", "comments"],
};

function ClientProfile() {
  const { clientId } = Route.useParams();
  const { programId: selectedProgramId, tab } = Route.useSearch();
  const s = useAppState();
  const client = s.clients.find((c) => c.id === clientId);
  const [editOpen, setEditOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTemplateId, setSendTemplateId] = useState<string | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  const [activeAssignment, setActiveAssignment] = useState<FormAssignment | null>(null);
  const [mergeAssignment, setMergeAssignment] = useState<FormAssignment | null>(null);
  const [formReadOnly, setFormReadOnly] = useState(false);
  const [note, setNote] = useState("");
  const [report, setReport] = useState({
    originalNeed: "",
    resultsAchieved: "",
    issuesEncountered: "",
    recommendedNextSteps: "",
    staffComments: "",
    clientOutcome: "Program Complete",
    archiveDecision: ARCHIVE_DECISIONS[0],
  });

  // Monitoring dialog state
  const [monitoringOpen, setMonitoringOpen] = useState(false);
  const [monitoringForm, setMonitoringForm] = useState({
    name: "Follow-up meeting",
    frequency: "monthly" as const,
    dueDate: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
    notes: "",
  });

  // Documents
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  // Communications
  const [commType, setCommType] = useState<"Note" | "Email" | "Call" | "Meeting">("Note");
  const [commSubject, setCommSubject] = useState("");
  const [commDirection, setCommDirection] = useState<"Inbound" | "Outbound" | "Internal">(
    "Internal",
  );

  useEffect(() => {
    const refresh = () => {
      void refreshClientProfile(clientId).catch(() => undefined);
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [clientId]);

  if (!client)
    return (
      <p className="text-sm text-muted-foreground">
        Client not found.{" "}
        <Link to="/clients" className="text-primary">
          Back to clients
        </Link>
      </p>
    );

  const enrollments = s.enrollments.filter((enrollment) => enrollment.clientId === client.id);
  const program = s.programs.find(
    (candidate) => candidate.id === enrollments[0]?.programId || candidate.id === client.programId,
  );
  const assignments = s.formAssignments.filter((a) => a.clientId === client.id);
  const terms = s.terms.filter((t) => t.clientId === client.id);
  const enrollmentIds = new Set(enrollments.map((enrollment) => enrollment.id));
  const monitoring = s.monitoring.filter((item) => enrollmentIds.has(item.enrollmentId));
  const docs = s.documents.filter((d) => d.clientId === client.id);
  const comms = s.communications.filter((c) => c.clientId === client.id);
  const contracts = s.contracts.filter((c) => c.clientId === client.id);
  const finals = s.finalReports.filter((f) => f.clientId === client.id);
  const logs = s.activity.filter((a) => a.clientId === client.id);
  const intakeSubmissions = s.intakeSubmissions.filter(
    (submission) => submission.clientId === client.id,
  );
  const templateName = (id: string) => s.formTemplates.find((t) => t.id === id)?.name ?? id;
  // Most recent submission that carries a core-section snapshot, i.e. what was actually asked.
  const latestCoreSubmission = [...intakeSubmissions]
    .filter((submission) =>
      submission.snapshot?.renderedSections.some((section) => section.kind === "core"),
    )
    .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))[0];
  const submittedFields = submittedCoreFields(latestCoreSubmission);
  const latestCoreFieldTokens = latestCoreSubmission
    ? new Set(
        (
          latestCoreSubmission.snapshot?.renderedSections.find(
            (section) => section.kind === "core",
          )?.fields ?? []
        ).flatMap((field) => [field.id.toLowerCase(), field.prefillKey?.toLowerCase() ?? ""]),
      )
    : null;
  // No submission on record (e.g. manually created client) — keep showing whatever is on file.
  const hasActiveIntakeField = (key: Exclude<keyof IntakeDetails, "uploadedFiles">) =>
    !latestCoreFieldTokens || INTAKE_KEY_ALIASES[key].some((alias) => latestCoreFieldTokens.has(alias));
  const selectedEnrollment = selectedProgramId
    ? enrollments.find((enrollment) => enrollment.programId === selectedProgramId)
    : undefined;
  const selectedProgram = selectedEnrollment
    ? s.programs.find((candidate) => candidate.id === selectedEnrollment.programId)
    : undefined;
  const selectedProgramAssignments = selectedEnrollment
    ? assignments.filter((assignment) => {
        if (assignment.enrollmentId) return assignment.enrollmentId === selectedEnrollment.id;
        return (
          s.formTemplates.find((template) => template.id === assignment.formId)?.programId ===
          selectedEnrollment.programId
        );
      })
    : [];
  const selectedProgramMonitoring = selectedEnrollment
    ? monitoring.filter((item) => item.enrollmentId === selectedEnrollment.id)
    : [];
  const programAnswerGroups = enrollments.flatMap((enrollment) => {
    for (const submission of intakeSubmissions) {
      const link = submission.programs.find(
        (candidate) =>
          candidate.enrollmentId === enrollment.id || candidate.programId === enrollment.programId,
      );
      const section = submission.snapshot?.renderedSections.find(
        (candidate) => candidate.kind === "program" && candidate.programId === enrollment.programId,
      );
      if (!link || !section) continue;
      const storedResponses = link.responsePayload ?? {};
      const responses =
        Object.keys(storedResponses).length > 0
          ? storedResponses
          : Object.fromEntries(
              section.fields.map((field) => [field.id, submission.responsePayload[field.id]]),
            );
      return [
        {
          enrollment,
          program: s.programs.find((candidate) => candidate.id === enrollment.programId),
          section,
          responses,
          submittedAt: submission.submittedAt,
        },
      ];
    }
    return [];
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title={client.businessName}
        description={`${client.primaryContactName} · ${client.email} · ${client.phone}`}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil className="size-4" />
              Edit client
            </Button>
            <Button
              onClick={() => {
                setSendTemplateId(null);
                setSendOpen(true);
              }}
            >
              Send program form
            </Button>
            <Button variant="outline" onClick={() => setTermsOpen(true)}>
              Create terms
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await generateContract(client.id, terms[0]?.id);
                toast.success("Draft contract generated");
              }}
            >
              Generate contract
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                updateClient(client.id, {
                  nextFollowUpDate: new Date(Date.now() + 7 * 864e5).toISOString(),
                });
                toast.success("Follow-up scheduled in 7 days");
              }}
            >
              Schedule follow-up
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                archiveClient(client.id);
                toast.success("Moved to archive");
              }}
            >
              Move to archive
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={client.status} />
        {client.relationshipType && <StatusBadge status={client.relationshipType} />}
        <span className="font-mono text-xs text-muted-foreground">
          {enrollments.length > 0
            ? `${enrollments.length} program enrollment${enrollments.length === 1 ? "" : "s"}`
            : (program?.name ?? "No program enrollments")}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          Staff: {client.assignedStaff}
        </span>
        <span className="font-mono text-xs text-muted-foreground">
          Next follow-up:{" "}
          {client.nextFollowUpDate ? new Date(client.nextFollowUpDate).toLocaleDateString() : "—"}
        </span>
        {client.convertedAt && (
          <span className="text-sm text-muted-foreground">
            Converted: {new Date(client.convertedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      {selectedProgram && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-y border-border py-3">
          <p className="text-sm">
            Viewing this profile in <span className="font-medium">{selectedProgram.name}</span>
          </p>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/programs/$programId" params={{ programId: selectedProgram.id }}>
              Back to program
            </Link>
          </Button>
        </div>
      )}

      <Tabs defaultValue={selectedProgram && tab === "program" ? "program" : "overview"}>
        <TabsList className="flex h-auto flex-wrap justify-start">
          {[
            ...(selectedProgram ? ["program"] : []),
            "overview",
            "intake",
            "forms",
            "monitoring",
            "documents",
            "communications",
            "contracts",
            "final",
            "activity",
          ].map((t) => (
            <TabsTrigger key={t} value={t} className="capitalize">
              {t === "final" ? "Final report" : t}
            </TabsTrigger>
          ))}
        </TabsList>

        {selectedProgram && selectedEnrollment && (
          <TabsContent value="program" className="mt-4 space-y-4">
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="shadow-card lg:col-span-2">
                <CardHeader>
                  <CardTitle className="font-display text-base">{selectedProgram.name}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-x-8 sm:grid-cols-2">
                  <dl>
                    <Row
                      label="Enrollment status"
                      value={selectedEnrollment.status.replace(/_/g, " ")}
                    />
                    <Row
                      label="Assigned staff"
                      value={selectedEnrollment.assignedStaff ?? undefined}
                    />
                    <Row
                      label="Start date"
                      value={
                        selectedEnrollment.startDate
                          ? new Date(selectedEnrollment.startDate).toLocaleDateString()
                          : undefined
                      }
                    />
                  </dl>
                  <dl>
                    <Row label="Next action" value={selectedEnrollment.nextAction ?? undefined} />
                    <Row
                      label="Next action date"
                      value={
                        selectedEnrollment.nextActionDate
                          ? new Date(selectedEnrollment.nextActionDate).toLocaleDateString()
                          : undefined
                      }
                    />
                    <Row
                      label="Open monitoring items"
                      value={String(
                        selectedProgramMonitoring.filter((item) => item.status !== "Completed")
                          .length,
                      )}
                    />
                  </dl>
                </CardContent>
              </Card>
              <Card className="shadow-card">
                <CardHeader>
                  <CardTitle className="font-display text-base">Progress</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="font-display text-4xl font-semibold">
                    {selectedEnrollment.progressPercentage}%
                  </p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full bg-primary"
                      style={{
                        width: `${Math.min(100, Math.max(0, selectedEnrollment.progressPercentage))}%`,
                      }}
                    />
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-base">Master intake answers</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-x-8 sm:grid-cols-2">
                <dl>
                  <Row label="Business description" value={client.intake.businessDescription} />
                  <Row label="Assistance requested" value={client.intake.assistanceRequested} />
                  <Row label="Program of interest" value={client.intake.programOfInterest} />
                  <Row label="Budget or funding need" value={client.intake.budgetNeed} />
                </dl>
                <dl>
                  <Row label="Preferred contact" value={client.intake.preferredContact} />
                  <Row label="How they heard about us" value={client.intake.heardAboutUs} />
                  <Row label="Additional comments" value={client.intake.additionalComments} />
                  <Row label="Uploaded files" value={client.intake.uploadedFiles.join(", ")} />
                </dl>
              </CardContent>
            </Card>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-base">Program questions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                {selectedProgramAssignments.length === 0 ? (
                  <p className="py-6 text-center text-sm text-muted-foreground">
                    No program forms have been assigned to this client yet.
                  </p>
                ) : (
                  selectedProgramAssignments.map((assignment) => {
                    const template = s.formTemplates.find(
                      (candidate) => candidate.id === assignment.formId,
                    );
                    return (
                      <section
                        key={assignment.id}
                        className="border-b border-border pb-5 last:border-0 last:pb-0"
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div>
                            <h3 className="text-sm font-medium">
                              {template?.name ?? assignment.formId}
                            </h3>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {assignment.submittedAt
                                ? `Submitted ${new Date(assignment.submittedAt).toLocaleDateString()}`
                                : "Not submitted"}
                            </p>
                          </div>
                          <StatusBadge status={assignment.status} />
                        </div>
                        {!assignment.responses || Object.keys(assignment.responses).length === 0 ? (
                          <p className="mt-4 text-sm text-muted-foreground">No answers recorded.</p>
                        ) : (
                          <dl className="mt-3 grid gap-x-8 sm:grid-cols-2">
                            {Object.entries(assignment.responses).map(([fieldId, answer]) => (
                              <Row
                                key={fieldId}
                                label={
                                  template?.fields.find((field) => field.id === fieldId)?.label ??
                                  fieldId
                                }
                                value={answer || undefined}
                              />
                            ))}
                          </dl>
                        )}
                      </section>
                    );
                  })
                )}
              </CardContent>
            </Card>
          </TabsContent>
        )}

        <TabsContent value="overview" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-base">Client summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <Row label="Business description" value={client.intake.businessDescription} />
                <Row label="What they need" value={client.intake.assistanceRequested} />
                <Row
                  label="Program enrollments"
                  value={
                    enrollments.length > 0
                      ? enrollments
                          .map(
                            (enrollment) =>
                              s.programs.find((item) => item.id === enrollment.programId)?.name,
                          )
                          .filter(Boolean)
                          .join(", ")
                      : program?.name
                  }
                />
                <Row label="Current status" value={client.status} />
                <Row
                  label="Internal decision"
                  value={terms[0]?.approvalStatus ?? "Pending review"}
                />
                <Row label="Assigned staff" value={client.assignedStaff} />
                <Row label="Created" value={new Date(client.createdAt).toLocaleDateString()} />
              </dl>
            </CardContent>
          </Card>
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-base">Open tasks & latest notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {monitoring
                .filter((m) => m.status !== "Completed")
                .map((m) => (
                  <div key={m.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{m.type}</span>
                      <StatusBadge status={m.status} />
                    </div>
                    <p className="mt-1 font-mono text-xs text-muted-foreground">
                      Due {new Date(m.dueDate).toLocaleDateString()} · {m.notes}
                    </p>
                  </div>
                ))}
              {comms.slice(0, 3).map((c) => (
                <div key={c.id} className="text-sm">
                  <span className="font-medium">{c.subject}</span>
                  <p className="text-muted-foreground">{c.notes}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="shadow-card lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display text-base">Program enrollments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {enrollments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No enrollment records yet. Legacy program information remains visible above.
                </p>
              ) : (
                enrollments.map((enrollment) => {
                  const enrollmentProgram = s.programs.find(
                    (item) => item.id === enrollment.programId,
                  );
                  return (
                    <div
                      key={enrollment.id}
                      className="grid gap-3 border-b border-border py-3 last:border-0 sm:grid-cols-[minmax(0,1fr)_auto]"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">
                            {enrollmentProgram?.name ?? "Unknown program"}
                          </p>
                          <StatusBadge status={enrollment.status} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Assigned to {enrollment.assignedStaff || "Unassigned"}
                          {enrollment.nextAction ? ` · Next: ${enrollment.nextAction}` : ""}
                        </p>
                      </div>
                      <div className="w-full sm:w-40">
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
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="intake" className="mt-4">
          <Card className="shadow-card">
            <CardContent className="grid gap-x-8 p-6 sm:grid-cols-2">
              <dl>
                <Row label="Client name" value={client.primaryContactName} />
                <Row label="Business name" value={client.businessName} />
                <Row label="Email" value={client.email} />
                <Row label="Phone" value={client.phone} />
                <Row label="Website" value={client.website} />
                <Row label="Social media links" value={client.socialLinks?.join(", ")} />
                {!submittedFields && (
                  <>
                    {hasActiveIntakeField("businessDescription") && (
                      <Row label="Business description" value={client.intake.businessDescription} />
                    )}
                    {hasActiveIntakeField("businessType") && (
                      <Row label="Business type" value={client.intake.businessType} />
                    )}
                  </>
                )}
              </dl>
              <dl>
                {submittedFields ? (
                  submittedFields.map(({ field, value }) => (
                    <Row key={field.id} label={field.label} value={value} />
                  ))
                ) : (
                  <>
                    {hasActiveIntakeField("assistanceRequested") && (
                      <Row
                        label="Type of assistance requested"
                        value={client.intake.assistanceRequested}
                      />
                    )}
                    {hasActiveIntakeField("programOfInterest") && (
                      <Row label="Program of interest" value={client.intake.programOfInterest} />
                    )}
                    {hasActiveIntakeField("budgetNeed") && (
                      <Row label="Budget or funding need" value={client.intake.budgetNeed} />
                    )}
                    {hasActiveIntakeField("preferredContact") && (
                      <Row label="Preferred contact method" value={client.intake.preferredContact} />
                    )}
                    {hasActiveIntakeField("heardAboutUs") && (
                      <Row label="How they heard about us" value={client.intake.heardAboutUs} />
                    )}
                    {hasActiveIntakeField("additionalComments") && (
                      <Row label="Additional comments" value={client.intake.additionalComments} />
                    )}
                    <Row label="Uploaded files" value={client.intake.uploadedFiles.join(", ")} />
                  </>
                )}
              </dl>
            </CardContent>
          </Card>
          {programAnswerGroups.map(({ enrollment, program, section, responses, submittedAt }) => (
            <Card key={enrollment.id} className="shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-base">
                  {program?.name ?? section.title} answers
                </CardTitle>
                <p className="text-xs text-muted-foreground">
                  Submitted {new Date(submittedAt).toLocaleString()}
                </p>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-x-8 sm:grid-cols-2">
                  {section.fields.map((field) => (
                    <Row
                      key={`${section.id}:${field.id}`}
                      label={field.label}
                      value={displayAnswer(responses[field.id])}
                    />
                  ))}
                </dl>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="forms" className="mt-4 space-y-3">
          {assignments.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No forms have been assigned to this profile yet.
            </p>
          )}
          {assignments.map((a) => {
            const prog = s.formTemplates.find((t) => t.id === a.formId);
            const progName = prog
              ? (s.programs.find((p) => p.id === prog.programId)?.name ?? "—")
              : "—";
            return (
              <Card key={a.id} className="shadow-card">
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{templateName(a.formId)}</p>
                      <p className="text-xs text-muted-foreground">{progName}</p>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                    <span>
                      Method:{" "}
                      <span className="capitalize font-medium text-foreground">
                        {a.completionMethod?.replace(/_/g, " ") ?? "—"}
                      </span>
                    </span>
                    <span>Sent: {a.sentAt ? new Date(a.sentAt).toLocaleDateString() : "—"}</span>
                    <span>Due: {a.dueDate ? new Date(a.dueDate).toLocaleDateString() : "—"}</span>
                    <span>
                      Opened: {a.openedAt ? new Date(a.openedAt).toLocaleDateString() : "—"}
                    </span>
                    <span>
                      Submitted:{" "}
                      {a.submittedAt ? new Date(a.submittedAt).toLocaleDateString() : "—"}
                    </span>
                    <span>Staff: {a.assignedUserId ?? client.assignedStaff}</span>
                  </div>
                  {a.secureLink && (
                    <p className="font-mono text-xs text-muted-foreground truncate">
                      {a.secureLink}
                    </p>
                  )}
                  {/* Status-based actions */}
                  <div className="flex flex-wrap gap-2">
                    {a.status === "draft" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setFormReadOnly(false);
                            setActiveAssignment(a);
                          }}
                        >
                          Continue
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            toast.info('Use "Assign a Form" to send a secure link to this client')
                          }
                        >
                          Send to Client
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await cancelFormAssignment(a.id);
                            toast.success("Form cancelled");
                          }}
                        >
                          Cancel
                        </Button>
                      </>
                    )}
                    {(["sent", "delivered", "opened", "in_progress"] as const).includes(
                      a.status as "sent" | "delivered" | "opened" | "in_progress",
                    ) && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            toast.info('Resend not yet configured — use "Assign a Form" instead')
                          }
                        >
                          Resend
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setFormReadOnly(true);
                            setActiveAssignment(a);
                          }}
                        >
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            setFormReadOnly(false);
                            setActiveAssignment(a);
                          }}
                        >
                          Fill Out With Client
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            await cancelFormAssignment(a.id);
                            toast.success("Link cancelled");
                          }}
                        >
                          Cancel Link
                        </Button>
                      </>
                    )}
                    {a.status === "submitted" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setSendTemplateId(a.formId);
                            setSendOpen(true);
                          }}
                        >
                          Send another form
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setFormReadOnly(true);
                            setActiveAssignment(a);
                          }}
                        >
                          Review Answers
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setMergeAssignment(a)}>
                          Apply to Profile
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toast.info("File attachments not yet available")}
                        >
                          View Attachments
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toast.info("Use the Communications tab to add notes")}
                        >
                          Add Note
                        </Button>
                      </>
                    )}
                    {a.status === "under_review" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setFormReadOnly(true);
                            setActiveAssignment(a);
                          }}
                        >
                          Review Answers
                        </Button>
                      </>
                    )}
                    {a.status === "approved" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setFormReadOnly(true);
                            setActiveAssignment(a);
                          }}
                        >
                          View Submission
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toast.info("File attachments not yet available")}
                        >
                          View Attachments
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toast.info("PDF download not yet available")}
                        >
                          Download
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toast.info("Archive not yet configured")}
                        >
                          Archive
                        </Button>
                      </>
                    )}
                    {(a.status === "cancelled" || a.status === "expired") && (
                      <span className="text-xs text-muted-foreground self-center">
                        No actions available
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          <Button
            onClick={() => {
              setSendTemplateId(null);
              setSendOpen(true);
            }}
          >
            Assign a form
          </Button>
        </TabsContent>

        <TabsContent value="monitoring" className="mt-4 space-y-3">
          {monitoring.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No monitoring items yet. Add one below to start tracking progress.
            </p>
          )}
          {monitoring.map((m) => (
            <Card key={m.id} className="shadow-card">
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">{m.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Next review{" "}
                      {m.nextReviewAt
                        ? new Date(m.nextReviewAt).toLocaleDateString()
                        : "not scheduled"}
                      {m.notes ? ` · ${m.notes}` : ""}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={m.complianceStatus} />
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await recordMonitoringResult(m.id, { complianceStatus: "compliant" });
                        toast.success("Monitoring review recorded");
                      }}
                    >
                      Record compliant
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
          <Button onClick={() => setMonitoringOpen(true)}>Add monitoring item</Button>
        </TabsContent>

        <TabsContent value="documents" className="mt-4 space-y-3">
          {docs.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No documents uploaded yet.
            </p>
          )}
          {docs.map((d) => (
            <Card key={d.id} className="shadow-card">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="font-medium">{d.name}</p>
                  <p className="font-mono text-xs text-muted-foreground">
                    {d.type} · {d.uploadedBy} · {new Date(d.uploadedAt).toLocaleDateString()}
                  </p>
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    void downloadDocument(d.id).catch((error: unknown) => {
                      toast.error(
                        error instanceof Error ? error.message : "Document download failed.",
                      );
                    });
                  }}
                >
                  Download
                </Button>
              </CardContent>
            </Card>
          ))}
          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              try {
                await uploadDocument(client.id, file);
                toast.success(`${file.name} uploaded`);
                e.target.value = "";
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Document upload failed.");
              } finally {
                setUploading(false);
              }
            }}
          />
          <Button disabled={uploading} onClick={() => fileInputRef.current?.click()}>
            {uploading ? "Uploading…" : "Upload document"}
          </Button>
        </TabsContent>

        <TabsContent value="communications" className="mt-4 space-y-3">
          <Card className="shadow-card">
            <CardContent className="space-y-3 p-5">
              <div className="flex flex-wrap gap-3">
                <div className="space-y-1.5">
                  <Label>Type</Label>
                  <Select value={commType} onValueChange={(v) => setCommType(v as typeof commType)}>
                    <SelectTrigger className="w-36">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["Note", "Email", "Call", "Meeting"] as const).map((t) => (
                        <SelectItem key={t} value={t}>
                          {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {commType !== "Note" && (
                  <div className="flex-1 min-w-48 space-y-1.5">
                    <Label>Subject</Label>
                    <Input
                      value={commSubject}
                      onChange={(e) => setCommSubject(e.target.value)}
                      placeholder="Subject or topic…"
                    />
                  </div>
                )}
                {(commType === "Email" || commType === "Call" || commType === "Meeting") && (
                  <div className="space-y-1.5">
                    <Label>Direction</Label>
                    <Select
                      value={commDirection}
                      onValueChange={(v) => setCommDirection(v as typeof commDirection)}
                    >
                      <SelectTrigger className="w-32">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(["Inbound", "Outbound", "Internal"] as const).map((d) => (
                          <SelectItem key={d} value={d}>
                            {d}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <Textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={
                  commType === "Note"
                    ? "Log a staff note…"
                    : "Notes or details about this communication…"
                }
              />
              <Button
                onClick={async () => {
                  if (!note.trim()) return;
                  const subject =
                    commType === "Note" ? "Staff note" : commSubject.trim() || commType;
                  await addCommunication(client.id, {
                    type: commType,
                    direction: commType === "Note" ? "Internal" : commDirection,
                    subject,
                    notes: note,
                    date: new Date().toISOString(),
                    staffMember: client.assignedStaff,
                  });
                  setNote("");
                  setCommSubject("");
                  toast.success(`${commType} logged`);
                }}
              >
                Log {commType.toLowerCase()}
              </Button>
            </CardContent>
          </Card>
          {comms.map((c) => (
            <Card key={c.id} className="shadow-card">
              <CardContent className="p-5">
                <div className="flex justify-between gap-3">
                  <p className="font-medium">{c.subject}</p>
                  <StatusBadge status={c.type} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{c.notes}</p>
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {c.direction} · {c.staffMember} · {new Date(c.date).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="contracts" className="mt-4 space-y-3">
          {contracts.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No contract generated yet. Use "Generate contract" above to create one.
            </p>
          )}
          {contracts.map((c) => (
            <Card key={c.id} className="shadow-card">
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">{c.contractType}</p>
                  <StatusBadge status={c.status} />
                </div>
                <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-4 font-sans text-xs whitespace-pre-wrap text-muted-foreground">
                  {c.content}
                </pre>
                <div className="flex flex-wrap gap-2">
                  {(c.status === "Draft" || c.status === "Internal Review") && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await updateContract(c.id, {
                          status: "Sent",
                          sentAt: new Date().toISOString(),
                        });
                        toast.success("Contract marked as sent");
                      }}
                    >
                      Mark as Sent
                    </Button>
                  )}
                  {c.status === "Sent" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        await updateContract(c.id, {
                          status: "Signed",
                          signedAt: new Date().toISOString(),
                        });
                        toast.success("Contract marked as signed");
                      }}
                    >
                      Mark as Signed
                    </Button>
                  )}
                  {c.status === "Signed" && (
                    <Button
                      size="sm"
                      onClick={async () => {
                        await updateContract(c.id, { status: "Completed" });
                        toast.success("Contract completed");
                      }}
                    >
                      Mark Completed
                    </Button>
                  )}
                  {(c.status === "Sent" || c.status === "Signed") && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={async () => {
                        await updateContract(c.id, { status: "Declined" });
                        toast.info("Contract marked declined");
                      }}
                    >
                      Mark Declined
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="final" className="mt-4 space-y-3">
          {finals.map((f) => (
            <Card key={f.id} className="shadow-card">
              <CardContent className="grid gap-x-8 p-6 sm:grid-cols-2">
                <dl>
                  <Row
                    label="Program term"
                    value={`${f.startDate.slice(0, 10)} → ${f.endDate.slice(0, 10)}`}
                  />
                  <Row label="Original need" value={f.originalNeed} />
                  <Row label="Support provided" value={f.supportProvided} />
                  <Row label="Funding provided" value={f.fundingProvided} />
                  <Row label="Milestones completed" value={f.milestonesCompleted} />
                </dl>
                <dl>
                  <Row label="Results achieved" value={f.resultsAchieved} />
                  <Row label="Issues encountered" value={f.issuesEncountered} />
                  <Row label="Staff comments" value={f.staffComments} />
                  <Row label="Client outcome" value={f.clientOutcome} />
                  <Row label="Archive decision" value={f.archiveDecision} />
                </dl>
              </CardContent>
            </Card>
          ))}
          <Card className="shadow-card">
            <CardContent className="space-y-3 p-5">
              <CardTitle className="font-display text-base">Complete final report</CardTitle>
              <div className="space-y-1.5">
                <Label>Original need / assistance requested</Label>
                <Textarea
                  rows={2}
                  value={report.originalNeed}
                  placeholder={client.intake.assistanceRequested}
                  onChange={(e) => setReport({ ...report, originalNeed: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Results achieved</Label>
                <Textarea
                  rows={2}
                  value={report.resultsAchieved}
                  onChange={(e) => setReport({ ...report, resultsAchieved: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Issues encountered</Label>
                <Textarea
                  rows={2}
                  value={report.issuesEncountered}
                  onChange={(e) => setReport({ ...report, issuesEncountered: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Staff comments</Label>
                <Textarea
                  rows={2}
                  value={report.staffComments}
                  onChange={(e) => setReport({ ...report, staffComments: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Client outcome</Label>
                <Input
                  value={report.clientOutcome}
                  onChange={(e) => setReport({ ...report, clientOutcome: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Recommended next steps</Label>
                <Textarea
                  rows={2}
                  value={report.recommendedNextSteps}
                  onChange={(e) => setReport({ ...report, recommendedNextSteps: e.target.value })}
                />
              </div>
              <Button
                onClick={async () => {
                  await createFinalReport(client.id, {
                    programId: client.programId ?? "",
                    startDate: client.createdAt,
                    endDate: new Date().toISOString(),
                    originalNeed: report.originalNeed || client.intake.assistanceRequested,
                    supportProvided: program?.name ?? "",
                    fundingProvided: terms[0] ? `$${terms[0].fundingAmount.toLocaleString()}` : "—",
                    milestonesCompleted: terms[0]?.milestones ?? "—",
                    resultsAchieved: report.resultsAchieved,
                    issuesEncountered: report.issuesEncountered || "None recorded",
                    staffComments: report.staffComments,
                    clientOutcome: report.clientOutcome,
                    recommendedNextSteps:
                      report.recommendedNextSteps || "Review for future programs",
                    archiveDecision: report.archiveDecision,
                  });
                  toast.success("Final report saved");
                }}
              >
                Save final report
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4 space-y-2">
          {logs.map((a) => (
            <div
              key={a.id}
              className="relative grid grid-cols-[80px_1fr] gap-4 rounded-lg border border-border px-5 py-3.5"
            >
              <div className="pt-0.5">
                <p className="font-mono text-[10px] leading-tight text-muted-foreground">
                  {new Date(a.timestamp).toLocaleDateString()}
                </p>
                <p className="mt-0.5 font-mono text-[9px] text-muted-foreground/70">
                  {new Date(a.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </p>
              </div>
              <div>
                <p className="text-sm font-medium">{a.action}</p>
                <p className="text-sm text-muted-foreground">{a.description}</p>
                <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{a.user}</p>
              </div>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      <FormRendererDialog
        key={activeAssignment?.id}
        assignment={activeAssignment}
        client={client}
        open={!!activeAssignment}
        onOpenChange={(v) => !v && setActiveAssignment(null)}
        readOnly={formReadOnly}
      />
      {mergeAssignment &&
        (() => {
          const tpl = s.formTemplates.find((t) => t.id === mergeAssignment.formId);
          if (!tpl) return null;
          return (
            <MergeResponsesDialog
              key={mergeAssignment.id}
              assignment={mergeAssignment}
              template={tpl}
              client={client}
              open={!!mergeAssignment}
              onOpenChange={(v) => !v && setMergeAssignment(null)}
            />
          );
        })()}
      <SendFormDialog
        client={client}
        templateId={sendTemplateId}
        open={sendOpen}
        onOpenChange={(nextOpen) => {
          setSendOpen(nextOpen);
          if (!nextOpen) setSendTemplateId(null);
        }}
      />
      <TermsDialog client={client} open={termsOpen} onOpenChange={setTermsOpen} />
      <EditClientDialog client={client} open={editOpen} onOpenChange={setEditOpen} />

      {/* Monitoring item dialog */}
      <Dialog open={monitoringOpen} onOpenChange={setMonitoringOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add monitoring item</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Type</Label>
              <Select
                value={monitoringForm.name}
                onValueChange={(v) => setMonitoringForm({ ...monitoringForm, name: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MONITORING_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {t}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Due date</Label>
              <Input
                type="date"
                value={monitoringForm.dueDate}
                onChange={(e) => setMonitoringForm({ ...monitoringForm, dueDate: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Notes</Label>
              <Textarea
                rows={2}
                value={monitoringForm.notes}
                onChange={(e) => setMonitoringForm({ ...monitoringForm, notes: e.target.value })}
                placeholder="Describe what needs to be checked or completed…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMonitoringOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={async () => {
                const enrollment = selectedEnrollment ?? enrollments[0];
                if (!monitoringForm.dueDate || !enrollment) return;
                await createEnrollmentMonitoring(enrollment.id, {
                  name: monitoringForm.name,
                  frequency: monitoringForm.frequency,
                  nextReviewAt: new Date(monitoringForm.dueDate + "T00:00:00").toISOString(),
                  notes: monitoringForm.notes,
                });
                setMonitoringOpen(false);
                setMonitoringForm({
                  name: "Follow-up meeting",
                  frequency: "monthly",
                  dueDate: new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
                  notes: "",
                });
                toast.success("Monitoring item added");
              }}
            >
              Add item
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
