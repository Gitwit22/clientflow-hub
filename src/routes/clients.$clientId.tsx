import { useEffect, useState, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Pencil } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { ClientSendMenu, SendToClientPanel } from "@/components/clients/ClientSendMenu";
import { EnrollmentContextBar } from "@/components/clients/EnrollmentContextBar";
import { toText } from "@/lib/answer-text";
import { contractSendState, currentContract, newIdempotencyKey, type SendKind } from "@/lib/client-send";
import {
  CLIENT_TABS,
  CLIENT_TAB_LABELS,
  inSelectedEnrollment,
  needsSearchNormalization,
  parseClientProfileSearch,
  resolveSelectedEnrollmentId,
  type ClientTab,
} from "@/lib/client-profile";
import { displayEnrollmentStatus, uniqueEnrollments } from "@/lib/enrollment-status";
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
import { SendContractDialog } from "@/components/dialogs/SendContractDialog";
import { SendFormDialog } from "@/components/dialogs/SendFormDialog";
import { SendIntakeDialog } from "@/components/dialogs/SendIntakeDialog";
import { SendWelcomeDialog } from "@/components/dialogs/SendWelcomeDialog";
import { TermsDialog } from "@/components/dialogs/TermsDialog";
import { SetUpPaymentsDialog, type InitialPaymentStatus } from "@/components/dialogs/SetUpPaymentsDialog";
import { RecordPaymentDialog } from "@/components/dialogs/RecordPaymentDialog";
import { BringAccountCurrentDialog } from "@/components/dialogs/BringAccountCurrentDialog";
import { PaymentLedgerDialog } from "@/components/dialogs/PaymentLedgerDialog";
import { getState, useAppState } from "@/lib/store";
import {
  addCommunication,
  archiveClient,
  cancelFormAssignment,
  createEnrollment,
  createEnrollmentMonitoring,
  createFinalReport,
  downloadDocument,
  downloadExecutedContract,
  refreshClientCommunications,
  refreshClientProfile,
  sendFormEmail,
  recordMonitoringResult,
  restoreClient,
  updateClient,
  uploadDocument,
} from "@/lib/api";
import {
  cfGetEnrollmentBillingSummary,
  cfGetProgramBillingConfig,
} from "@/lib/apiClient";
import {
  ARCHIVE_DECISIONS,
  type EnrollmentBillingSummary,
  type FormAssignment,
  type IntakeDetails,
  type IntakeSubmission,
  type ProgramBillingConfig,
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
  validateSearch: parseClientProfileSearch,
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
      value: toText(submission.responsePayload[field.id]),
    }));
}

// Mirrors the ClientFlow intake field keys so we can tell whether a
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
  const { enrollmentId: enrollmentIdParam, programId: legacyProgramId, tab } = Route.useSearch();
  const navigate = Route.useNavigate();
  const s = useAppState();
  const globalClient = s.clients.find((c) => c.id === clientId);
  const [fetchedClient, setFetchedClient] = useState<typeof globalClient | null>(null);
  const [loadingClient, setLoadingClient] = useState(!globalClient);
  const [clientError, setClientError] = useState<string | null>(null);

  const client = globalClient || fetchedClient;

  // Program context comes only from this client's enrollments, and the selected one comes only
  // from the URL (?enrollmentId=), so a refresh or a different entry point can't change it.
  const enrollments = uniqueEnrollments(s.enrollments.filter((e) => e.clientId === clientId));
  const searchForSelection = { enrollmentId: enrollmentIdParam, programId: legacyProgramId };
  const selectedEnrollmentId = resolveSelectedEnrollmentId(enrollments, searchForSelection);
  const selectedEnrollment = enrollments.find((e) => e.id === selectedEnrollmentId);
  const shouldNormalizeSearch = needsSearchNormalization(selectedEnrollmentId, searchForSelection);
  const activeTab: ClientTab = tab ?? "overview";

  const selectEnrollment = (nextEnrollmentId: string) =>
    navigate({
      search: (prev) => ({ ...prev, enrollmentId: nextEnrollmentId, programId: undefined }),
      replace: true,
    });

  const [editOpen, setEditOpen] = useState(false);
  const [sendOpen, setSendOpen] = useState(false);
  const [sendTemplateId, setSendTemplateId] = useState<string | null>(null);
  const [termsOpen, setTermsOpen] = useState(false);
  // One place to send anything to the client: which send dialog is open (if any).
  const [sendDialog, setSendDialog] = useState<SendKind | null>(null);
  const [sendingDraftId, setSendingDraftId] = useState<string | null>(null);
  const [schedulingFollowUp, setSchedulingFollowUp] = useState(false);
  const [activeAssignment, setActiveAssignment] = useState<FormAssignment | null>(null);
  const [mergeAssignment, setMergeAssignment] = useState<FormAssignment | null>(null);
  const [formReadOnly, setFormReadOnly] = useState(false);

  // Billing & payments (fetched on-demand per selected enrollment, not part of the global store)
  const [billingSummary, setBillingSummary] = useState<EnrollmentBillingSummary | null>(null);
  const [billingProgramConfig, setBillingProgramConfig] = useState<ProgramBillingConfig | null>(null);
  const [loadingBilling, setLoadingBilling] = useState(false);
  const [billingRefreshVersion, setBillingRefreshVersion] = useState(0);
  const [setUpPaymentsOpen, setSetUpPaymentsOpen] = useState(false);
  const [recordPaymentOpen, setRecordPaymentOpen] = useState(false);
  const [bringCurrentOpen, setBringCurrentOpen] = useState(false);
  const [bringCurrentMode, setBringCurrentMode] = useState<"current" | "partial_unknown">("current");
  const [ledgerOpen, setLedgerOpen] = useState(false);

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

  // Archive dialog
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [archiveReasonInput, setArchiveReasonInput] = useState("Archived by staff");
  const [archiveFinalStatusInput, setArchiveFinalStatusInput] = useState("Archived");
  const [archiving, setArchiving] = useState(false);
  const [restoring, setRestoring] = useState(false);

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

  // Fetch client on-demand if not in global state (fallback for program detail navigation)
  useEffect(() => {
    if (globalClient) {
      setFetchedClient(null);
      setLoadingClient(false);
      setClientError(null);
      return;
    }

    setLoadingClient(true);
    setClientError(null);
    void (async () => {
      try {
        const data = await refreshClientProfile(clientId);
        setFetchedClient(data);
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unable to load client.";
        setClientError(message);
      } finally {
        setLoadingClient(false);
      }
    })();
  }, [clientId, globalClient]);

  useEffect(() => {
    const refresh = () => {
      if (getState().clients.some((candidate) => candidate.id === clientId)) {
        void refreshClientProfile(clientId).catch(() => undefined);
      }
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => window.removeEventListener("focus", refresh);
  }, [clientId]);

  // Normalize the URL once the client is loaded: add the selected enrollmentId (so View and
  // Payments land on the same address) and drop the legacy ?programId=.
  useEffect(() => {
    if (!client || !shouldNormalizeSearch) return;
    void navigate({
      search: (prev) => ({ ...prev, enrollmentId: selectedEnrollmentId, programId: undefined }),
      replace: true,
    });
  }, [client?.id, shouldNormalizeSearch, selectedEnrollmentId, navigate]);

  // Billing is fetched from the backend by (clientId, enrollmentId); there is no second store.
  const billingFetchedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!client || !selectedEnrollment) {
      billingFetchedFor.current = null;
      setBillingSummary(null);
      setBillingProgramConfig(null);
      return;
    }
    // Never show the previous enrollment's agreement while the new one loads.
    if (billingFetchedFor.current !== selectedEnrollment.id) {
      billingFetchedFor.current = selectedEnrollment.id;
      setBillingSummary(null);
      setBillingProgramConfig(null);
    }
    let cancelled = false;
    setLoadingBilling(true);
    void Promise.all([
      cfGetEnrollmentBillingSummary(client.id, selectedEnrollment.id),
      cfGetProgramBillingConfig(selectedEnrollment.programId),
    ])
      .then(([summary, config]) => {
        if (cancelled) return;
        setBillingSummary(summary);
        setBillingProgramConfig(config);
      })
      .catch((error: unknown) => {
        if (!cancelled) toast.error(error instanceof Error ? error.message : "Unable to load billing details.");
      })
      .finally(() => {
        if (!cancelled) setLoadingBilling(false);
      });
    return () => {
      cancelled = true;
    };
  }, [client?.id, selectedEnrollment?.id, billingRefreshVersion]);

  if (loadingClient)
    return (
      <div className="space-y-4">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/clients"><ArrowLeft className="mr-2 h-4 w-4" />Clients</Link>
        </Button>
        <Card className="shadow-card"><CardContent className="py-12 text-center text-sm text-muted-foreground">Loading client profile...</CardContent></Card>
      </div>
    );

  if (!client || clientError)
    return (
      <p className="text-sm text-muted-foreground">
        {clientError || "Client not found."}{" "}
        <Link to="/clients" className="text-primary">
          Back to clients
        </Link>
      </p>
    );

  const selectedProgram = selectedEnrollment
    ? s.programs.find((candidate) => candidate.id === selectedEnrollment.programId)
    : undefined;
  // Enrollment-scoped tabs read the selected enrollment. Records that carry an enrollmentId follow
  // it; records without one are client-wide and stay visible for every enrollment.
  const inScope = (record: { enrollmentId?: string | null }) =>
    inSelectedEnrollment(record, selectedEnrollment?.id);
  const templateProgramId = (formId: string) =>
    s.formTemplates.find((template) => template.id === formId)?.programId;
  const assignments = s.formAssignments
    .filter((a) => a.clientId === client.id)
    .filter((a) => {
      if (!selectedEnrollment) return true;
      if (a.enrollmentId) return a.enrollmentId === selectedEnrollment.id;
      const programId = templateProgramId(a.formId);
      return !programId || programId === selectedEnrollment.programId;
    });
  const terms = s.terms.filter((t) => t.clientId === client.id && inScope(t));
  const monitoring = s.monitoring.filter((item) =>
    selectedEnrollment
      ? item.enrollmentId === selectedEnrollment.id
      : enrollments.some((enrollment) => enrollment.id === item.enrollmentId),
  );
  const docs = s.documents.filter((d) => d.clientId === client.id && d.type !== "contract" && inScope(d));
  const comms = s.communications.filter((c) => c.clientId === client.id && inScope(c));
  const contracts = s.contracts.filter((c) => c.clientId === client.id && inScope(c));
  const executedContractDocs = s.documents.filter(
    (d) => d.clientId === client.id && d.type === "contract" && inScope(d),
  );
  const finals = s.finalReports.filter((f) => f.clientId === client.id && inScope(f));
  const logs = s.activity.filter((a) => a.clientId === client.id && inScope(a));
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
  // Program tab: only forms that belong to this enrollment/program (client-wide forms stay on Forms).
  const selectedProgramAssignments = selectedEnrollment
    ? assignments.filter(
        (assignment) =>
          assignment.enrollmentId || templateProgramId(assignment.formId) === selectedEnrollment.programId,
      )
    : [];
  const selectedProgramMonitoring = selectedEnrollment ? monitoring : [];
  const programAnswerGroups = (selectedEnrollment ? [selectedEnrollment] : enrollments).flatMap((enrollment) => {
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

  const openSend = (kind: SendKind) => setSendDialog(kind);
  const closeSend = (nextOpen: boolean) => {
    if (!nextOpen) setSendDialog(null);
  };
  const staffSigner = {
    name:
      [s.authenticatedAdmin?.firstName, s.authenticatedAdmin?.lastName].filter(Boolean).join(" ") ||
      s.authenticatedAdmin?.email ||
      "",
    id: s.authenticatedAdmin?.id,
  };

  // Sends a form that was already assigned as a draft, through the same delivery path as everything else.
  async function sendDraftAssignment(assignment: FormAssignment) {
    if (sendingDraftId) return;
    setSendingDraftId(assignment.id);
    try {
      const result = await sendFormEmail(assignment.id, undefined, newIdempotencyKey());
      toast.success(`${result.message} Sent to ${result.recipientEmail}.`);
      void refreshClientCommunications(client!.id).catch(() => undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to send this form.");
    } finally {
      setSendingDraftId(null);
    }
  }

  async function scheduleFollowUp() {
    setSchedulingFollowUp(true);
    try {
      await updateClient(client!.id, {
        nextFollowUpDate: new Date(Date.now() + 7 * 864e5).toISOString(),
      });
      toast.success("Follow-up scheduled in 7 days");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to schedule the follow-up.");
    } finally {
      setSchedulingFollowUp(false);
    }
  }

  const contractState = contractSendState(currentContract(contracts, selectedEnrollment?.id));
  const contractSummary =
    contractState.kind === "signed"
      ? `Signed ${contractState.contract.signedAt ? new Date(contractState.contract.signedAt).toLocaleDateString() : ""}`.trim()
      : contractState.kind === "sent" || contractState.kind === "opened"
        ? `${contractState.kind === "opened" ? "Opened" : "Sent"}, waiting for a signature`
        : contractState.kind === "draft"
          ? "Draft ready to send"
          : contractState.kind === "closed"
            ? "The previous contract is closed"
            : "No contract yet";
  const contractActionLabel =
    contractState.kind === "signed"
      ? "Send copy"
      : contractState.kind === "sent" || contractState.kind === "opened"
        ? "Resend signing link"
        : "Send contract";

  const noEnrollmentNotice = (
    <Card className="shadow-card">
      <CardContent className="py-10 text-center text-sm text-muted-foreground">
        Enroll this client in a program to use this tab.
      </CardContent>
    </Card>
  );

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
            <ClientSendMenu hasEnrollment={!!selectedEnrollment} onSelect={openSend} />
            {client.isArchived ? (
              <Button
                variant="outline"
                disabled={restoring}
                onClick={async () => {
                  setRestoring(true);
                  try {
                    await restoreClient(client.id);
                    toast.success("Client restored to active");
                  } catch (error) {
                    toast.error(
                      error instanceof Error ? error.message : "Unable to restore this client.",
                    );
                  } finally {
                    setRestoring(false);
                  }
                }}
              >
                {restoring ? "Restoring…" : "Restore client"}
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setArchiveOpen(true)}>
                Move to archive
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={client.status} />
        {client.relationshipType && <StatusBadge status={client.relationshipType} />}
        <span className="font-mono text-xs text-muted-foreground">
          {enrollments.length > 0
            ? `${enrollments.length} program enrollment${enrollments.length === 1 ? "" : "s"}`
            : "No program enrollments"}
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

      {client.isArchived && (
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm">
          <p className="font-medium">Archived</p>
          <p className="mt-1 text-xs text-muted-foreground">
            Reason: {client.archiveReason ?? "—"} · Final status: {client.finalStatus ?? "—"} ·
            Archived{" "}
            {client.archivedAt ? new Date(client.archivedAt).toLocaleDateString() : "—"}
          </p>
          <Button
            size="sm"
            variant="ghost"
            className="mt-2"
            disabled={finals.length === 0}
            onClick={() => toast.info("PDF download not yet available")}
          >
            Download final report
          </Button>
        </div>
      )}

      <EnrollmentContextBar
        enrollments={enrollments}
        programs={s.programs}
        selectedEnrollmentId={selectedEnrollment?.id}
        canEnroll={!client.isArchived}
        onSelect={selectEnrollment}
        onEnroll={async (programId) => {
          try {
            const enrollment = await createEnrollment({
              clientId: client.id,
              programId,
              status: "interested",
            });
            toast.success(
              `Enrolled in ${s.programs.find((p) => p.id === programId)?.name ?? "the program"}.`,
            );
            await selectEnrollment(enrollment.id);
          } catch (error) {
            toast.error(
              error instanceof Error ? error.message : "Unable to enroll this client in the program.",
            );
          }
        }}
      />

      <Tabs
        value={activeTab}
        onValueChange={(nextTab) =>
          navigate({ search: (prev) => ({ ...prev, tab: nextTab as ClientTab }), replace: true })
        }
      >
        <TabsList className="flex h-auto flex-wrap justify-start">
          {CLIENT_TABS.map((t) => (
            <TabsTrigger key={t} value={t}>
              {CLIENT_TAB_LABELS[t]}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="program" className="mt-4 space-y-4">
          {!selectedProgram || !selectedEnrollment ? (
            noEnrollmentNotice
          ) : (
            <>
            <div className="grid gap-4 lg:grid-cols-3">
              <Card className="shadow-card lg:col-span-2">
                <CardHeader>
                  <CardTitle className="font-display text-base">{selectedProgram.name}</CardTitle>
                </CardHeader>
                <CardContent className="grid gap-x-8 sm:grid-cols-2">
                  <dl>
                    <Row
                      label="Enrollment status"
                      value={displayEnrollmentStatus(selectedEnrollment.status)}
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
                  <CardTitle className="font-display text-base">Status</CardTitle>
                </CardHeader>
                <CardContent>
                  <StatusBadge status={displayEnrollmentStatus(selectedEnrollment.status)} />
                </CardContent>
              </Card>
            </div>

            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-base">Funding & service terms</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {terms.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No terms have been drafted for this program yet.
                  </p>
                ) : (
                  terms.map((t) => (
                    <div
                      key={t.id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border p-3 text-sm"
                    >
                      <span className="font-medium">
                        {t.supportType} · ${t.fundingAmount.toLocaleString()}
                      </span>
                      <StatusBadge status={t.approvalStatus} />
                    </div>
                  ))
                )}
                <Button type="button" variant="outline" size="sm" onClick={() => setTermsOpen(true)}>
                  Create terms
                </Button>
              </CardContent>
            </Card>

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
                                value={toText(answer) || undefined}
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
            </>
          )}
        </TabsContent>

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
                    enrollments
                      .map(
                        (enrollment) =>
                          s.programs.find((item) => item.id === enrollment.programId)?.name,
                      )
                      .filter(Boolean)
                      .join(", ") || undefined
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
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-base">Follow-up</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm">
                Next follow-up:{" "}
                <span className="font-medium">
                  {client.nextFollowUpDate
                    ? new Date(client.nextFollowUpDate).toLocaleDateString()
                    : "Not scheduled"}
                </span>
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={schedulingFollowUp}
                onClick={() => void scheduleFollowUp()}
              >
                {schedulingFollowUp ? "Scheduling…" : "Schedule follow-up (7 days)"}
              </Button>
            </CardContent>
          </Card>
          <Card className="shadow-card lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display text-base">Program enrollments</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {enrollments.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No program enrollments yet. Use the enrollment selector above to enroll this client.
                </p>
              ) : (
                enrollments.map((enrollment) => {
                  const enrollmentProgram = s.programs.find(
                    (item) => item.id === enrollment.programId,
                  );
                  return (
                    <Link
                      key={enrollment.id}
                      to="/clients/$clientId"
                      params={{ clientId: client.id }}
                      search={{ enrollmentId: enrollment.id, tab: "billing" }}
                      className="block border-b border-border py-3 last:border-0 hover:bg-muted/40"
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-medium">
                            {enrollmentProgram?.name ?? "Unknown program"}
                          </p>
                          <StatusBadge status={displayEnrollmentStatus(enrollment.status)} />
                        </div>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Assigned to {enrollment.assignedStaff || "Unassigned"}
                          {enrollment.nextAction ? ` · Next: ${enrollment.nextAction}` : ""}
                        </p>
                      </div>
                    </Link>
                  );
                })
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="billing" className="mt-4 space-y-4">
          {!selectedProgram || !selectedEnrollment ? (
            noEnrollmentNotice
          ) : (
            <>
            <Card className="shadow-card">
              <CardHeader>
                <CardTitle className="font-display text-base">Billing & payments</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4 text-sm">
                {loadingBilling && !billingSummary ? (
                  <p className="text-sm text-muted-foreground">Loading billing details...</p>
                ) : !billingSummary?.agreement ? (
                  <div className="space-y-3">
                    <p className="text-sm text-muted-foreground">Payment setup required</p>
                    <Button onClick={() => setSetUpPaymentsOpen(true)}>Set Up Payments</Button>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <p className="font-display text-lg font-semibold">{selectedProgram.name}</p>
                      <p className="text-muted-foreground">
                        ${billingSummary.agreement.amount.toLocaleString()} / {billingSummary.agreement.frequency.replace("_", "-")}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Active since {new Date(billingSummary.agreement.startDate).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-4 text-center">
                      <div>
                        <p className="font-display text-xl font-semibold">${billingSummary.collected.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Collected</p>
                      </div>
                      <div>
                        <p className="font-display text-xl font-semibold">${billingSummary.expected.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Expected</p>
                      </div>
                      <div>
                        <p className="font-display text-xl font-semibold">${billingSummary.outstanding.toLocaleString()}</p>
                        <p className="text-xs text-muted-foreground">Outstanding</p>
                      </div>
                    </div>
                    {billingSummary.nextDueDate && (
                      <p className="text-xs text-muted-foreground">
                        Next payment: {new Date(billingSummary.nextDueDate).toLocaleDateString()}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setRecordPaymentOpen(true)}>Record Payment</Button>
                      <Button variant="outline" onClick={() => setSetUpPaymentsOpen(true)}>
                        Update Agreement
                      </Button>
                      <Button variant="outline" onClick={() => setLedgerOpen(true)}>
                        View Ledger
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => {
                          setBringCurrentMode("current");
                          setBringCurrentOpen(true);
                        }}
                      >
                        Bring Account Current
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
            </>
          )}
        </TabsContent>

        <TabsContent value="forms" className="mt-4 space-y-3">
          <SendToClientPanel hasEnrollment={!!selectedEnrollment} onSelect={openSend} />
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-base">Intake</CardTitle>
            </CardHeader>
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
                      value={toText(responses[field.id])}
                    />
                  ))}
                </dl>
              </CardContent>
            </Card>
          ))}
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
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={sendingDraftId === a.id}
                          onClick={() => void sendDraftAssignment(a)}
                        >
                          {sendingDraftId === a.id ? "Sending…" : "Send to Client"}
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
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          onClick={() => setMergeAssignment(a)}
                        >
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
            type="button"
            onClick={() => openSend(selectedEnrollment ? "program_form" : "general_form")}
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
                  <StatusBadge status={c.status ?? c.type} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{c.notes}</p>
                <p className="mt-2 font-mono text-xs text-muted-foreground">
                  {c.direction} · {c.staffMember} · {new Date(c.date).toLocaleDateString()}
                  {c.status ? ` · ${c.status}` : ""}
                  {c.errorCode ? ` · ${c.errorCode}` : ""}
                </p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="contracts" className="mt-4 space-y-3">
          {selectedEnrollment ? (
            <Card className="shadow-card">
              <CardContent className="flex flex-wrap items-center justify-between gap-3 p-5">
                <div>
                  <p className="font-medium">{selectedProgram?.name ?? "Program"} contract</p>
                  <p className="text-xs text-muted-foreground">{contractSummary}</p>
                </div>
                <Button type="button" onClick={() => openSend("contract")}>
                  {contractActionLabel}
                </Button>
              </CardContent>
            </Card>
          ) : (
            noEnrollmentNotice
          )}
          {contracts.map((c) => (
            <Card key={c.id} className="shadow-card">
              <CardContent className="space-y-3 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">{c.contractType}</p>
                  <StatusBadge status={c.status} />
                </div>
                <pre className="max-h-64 overflow-auto rounded-lg bg-muted p-4 font-sans text-xs whitespace-pre-wrap text-muted-foreground">
                  {c.generatedContent}
                </pre>
                <div className="flex flex-wrap gap-2">
                  {(c.status === "DRAFT" || c.status === "SENT" || c.status === "OPENED") && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openSend("contract")}
                    >
                      {c.status === "DRAFT" ? "Send" : "Resend signing link"}
                    </Button>
                  )}
                  {c.status === "COMPLETED" && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => openSend("contract")}
                    >
                      Send copy
                    </Button>
                  )}
                  {c.executedStoredFileId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        void downloadExecutedContract(client.id, c.id).catch((error: unknown) => {
                          toast.error(
                            error instanceof Error ? error.message : "Contract download failed.",
                          );
                        });
                      }}
                    >
                      Download signed agreement
                    </Button>
                  )}
                  {c.status === "COMPLETED" && !c.executedStoredFileId && (
                    <span className="text-xs text-muted-foreground self-center">
                      Signed artifact not available yet.
                    </span>
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
                    programId: selectedEnrollment?.programId ?? "",
                    enrollmentId: selectedEnrollment?.id ?? null,
                    startDate: client.createdAt,
                    endDate: new Date().toISOString(),
                    originalNeed: report.originalNeed || client.intake.assistanceRequested,
                    supportProvided: selectedProgram?.name ?? "",
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
      {mergeAssignment && (
        <MergeResponsesDialog
          key={mergeAssignment.id}
          assignment={mergeAssignment}
          client={client}
          open={!!mergeAssignment}
          onOpenChange={(v) => !v && setMergeAssignment(null)}
        />
      )}
      <SendFormDialog
        client={client}
        templateId={sendTemplateId}
        open={sendOpen}
        onOpenChange={(nextOpen) => {
          setSendOpen(nextOpen);
          if (!nextOpen) setSendTemplateId(null);
        }}
      />
      <SendFormDialog
        client={client}
        kind="program"
        enrollment={selectedEnrollment ?? null}
        open={sendDialog === "program_form"}
        onOpenChange={closeSend}
      />
      <SendFormDialog
        client={client}
        kind="general"
        open={sendDialog === "general_form"}
        onOpenChange={closeSend}
      />
      <SendIntakeDialog client={client} open={sendDialog === "intake"} onOpenChange={closeSend} />
      {selectedEnrollment && (
        <>
          <SendContractDialog
            client={client}
            enrollment={selectedEnrollment}
            program={selectedProgram}
            contracts={contracts}
            staffSigner={staffSigner}
            open={sendDialog === "contract"}
            onOpenChange={closeSend}
          />
          <SendWelcomeDialog
            client={client}
            enrollment={selectedEnrollment}
            program={selectedProgram}
            contracts={contracts}
            communications={comms}
            open={sendDialog === "welcome"}
            onOpenChange={closeSend}
          />
        </>
      )}
      <TermsDialog
        client={client}
        enrollment={selectedEnrollment ?? null}
        open={termsOpen}
        onOpenChange={setTermsOpen}
      />
      <EditClientDialog client={client} open={editOpen} onOpenChange={setEditOpen} />

      {selectedEnrollment && (
        <>
          <SetUpPaymentsDialog
            open={setUpPaymentsOpen}
            onOpenChange={setSetUpPaymentsOpen}
            clientId={client.id}
            enrollmentId={selectedEnrollment.id}
            programName={selectedProgram?.name ?? "this program"}
            programConfig={billingProgramConfig}
            existingAgreement={billingSummary?.agreement}
            onSaved={(_agreement, initialPaymentStatus: InitialPaymentStatus | null) => {
              setBillingRefreshVersion((v) => v + 1);
              if (initialPaymentStatus === "current" || initialPaymentStatus === "partial_unknown") {
                setBringCurrentMode(initialPaymentStatus);
                setBringCurrentOpen(true);
              }
            }}
          />
          <RecordPaymentDialog
            open={recordPaymentOpen}
            onOpenChange={setRecordPaymentOpen}
            clientId={client.id}
            enrollmentId={selectedEnrollment.id}
            agreementAmount={billingSummary?.agreement?.amount ?? 0}
            onSaved={() => setBillingRefreshVersion((v) => v + 1)}
          />
          <BringAccountCurrentDialog
            open={bringCurrentOpen}
            onOpenChange={setBringCurrentOpen}
            clientId={client.id}
            enrollmentId={selectedEnrollment.id}
            mode={bringCurrentMode}
            onDone={() => setBillingRefreshVersion((v) => v + 1)}
          />
          <PaymentLedgerDialog
            open={ledgerOpen}
            onOpenChange={setLedgerOpen}
            payments={billingSummary?.payments ?? []}
            onVoided={() => setBillingRefreshVersion((v) => v + 1)}
          />
        </>
      )}

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

      {/* Archive dialog */}
      <Dialog open={archiveOpen} onOpenChange={setArchiveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Archive client</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label>Reason</Label>
              <Textarea
                rows={2}
                value={archiveReasonInput}
                onChange={(e) => setArchiveReasonInput(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Final status</Label>
              <Input
                value={archiveFinalStatusInput}
                onChange={(e) => setArchiveFinalStatusInput(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setArchiveOpen(false)} disabled={archiving}>
              Cancel
            </Button>
            <Button
              disabled={archiving}
              onClick={async () => {
                setArchiving(true);
                try {
                  await archiveClient(client.id, archiveReasonInput, archiveFinalStatusInput);
                  toast.success("Moved to archive");
                  setArchiveOpen(false);
                } catch (error) {
                  toast.error(
                    error instanceof Error ? error.message : "Unable to archive this client.",
                  );
                } finally {
                  setArchiving(false);
                }
              }}
            >
              {archiving ? "Archiving…" : "Archive client"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
