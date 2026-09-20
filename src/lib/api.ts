/**
 * API service layer.
 *
 * Every function is async and returns a promise so the UI can be swapped from
 * the in-memory mock store to a real backend (Lovable Cloud / Supabase,
 * Firebase, Appwrite, Node/Express) without touching components.
 */
import { getState, retryBootstrap, setState, uid } from "./store";
import { emailTemplateBody } from "@/data/defaults";
import {
  cfCreateFormAssignment,
  cfCreateFormTemplate,
  cfDeleteFormTemplate,
  cfUpdateFormTemplate,
  cfCreateClient,
  cfDeleteClient,
  cfGetClient,
  cfListFormAssignments,
  cfUpdateClient,
  cfCreateProgram,
  cfGetProgramDetail,
  cfUpdateProgram,
  cfCreateEnrollment,
  cfListEnrollments,
  cfUpdateEnrollment,
  cfCreateTerms,
  cfUpdateTerms,
  cfCreateContract,
  cfUpdateContract,
  cfCreateEnrollmentMonitoring,
  cfRecordMonitoringResult,
  cfCreateDocumentUpload,
  cfCompleteDocumentUpload,
  cfGetDocumentDownload,
  cfCreateCommunication,
  cfCreateFinalReport,
  cfUpdateFormAssignment,
  cfCreateActivity,
  cfSendFormAssignment,
} from "./apiClient";
import type {
  ActivityLog,
  Client,
  ClientDocument,
  Communication,
  CompletionMethod,
  Contract,
  DeliveryMethod,
  FinalReport,
  FormAssignment,
  FormAssignmentStatus,
  FinalReportDraft,
  FormEdit,
  FormTemplate,
  EnrollmentMonitoring,
  Program,
  ProgramEnrollment,
  PublicFormResponseValue,
  RelationshipType,
  Terms,
} from "@/types";

const delay = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 120));

const nowISO = () => new Date().toISOString();

async function log(clientId: string, action: string, description: string) {
  try {
    const entry = (await cfCreateActivity({
      clientId,
      action,
      description,
    })) as ActivityLog;
    setState((s) => ({ ...s, activity: [entry, ...s.activity] }));
  } catch (error) {
    console.error("Unable to record activity", error);
  }
}

/* ---------------------------------- Clients --------------------------------- */

export const getClients = async () => delay(getState().clients);

export const getClientById = async (id: string) =>
  delay(getState().clients.find((c) => c.id === id) ?? null);

export async function refreshClientProfile(clientId: string) {
  const [client, assignments, enrollments] = await Promise.all([
    cfGetClient(clientId) as Promise<Client>,
    cfListFormAssignments(clientId) as Promise<FormAssignment[]>,
    cfListEnrollments({ clientId }),
  ]);
  setState((state) => ({
    ...state,
    clients: state.clients.some((existing) => existing.id === clientId)
      ? state.clients.map((existing) => (existing.id === clientId ? client : existing))
      : [client, ...state.clients],
    formAssignments: [
      ...assignments,
      ...state.formAssignments.filter((assignment) => assignment.clientId !== clientId),
    ],
    enrollments: [
      ...enrollments,
      ...state.enrollments.filter((enrollment) => enrollment.clientId !== clientId),
    ],
  }));
  return client;
}

export async function createClient(
  data: Omit<Client, "id" | "createdAt" | "updatedAt" | "isArchived">,
) {
  const backendClient = (await cfCreateClient({
    businessName: data.businessName,
    primaryContactName: data.primaryContactName,
    email: data.email,
    phone: data.phone,
    website: data.website,
    programId: data.programId,
    status: data.status,
    profileType: data.profileType,
    relationshipType: data.relationshipType,
    lifecycleStatus: data.lifecycleStatus,
    assignedStaff: data.assignedStaff,
    assignedUserId: data.assignedUserId,
    intakeSource: data.intakeSource,
    source: data.source,
    nextFollowUpDate: data.nextFollowUpDate,
    convertedAt: data.convertedAt,
    isDemo: data.isDemo,
    intake: data.intake,
    snapchat: data.snapchat,
  })) as Client;
  const client: Client = {
    ...data,
    ...backendClient,
  };
  setState((s) => ({ ...s, clients: [client, ...s.clients] }));
  await log(client.id, "Intake received", `New intake created for ${client.businessName}.`);
  return delay(client);
}

export async function updateClient(id: string, data: Partial<Client>) {
  const previousClient = getState().clients.find((client) => client.id === id);
  const updatedClient = (await cfUpdateClient(id, data as Record<string, unknown>)) as Client;
  const isArchiving = updatedClient.isArchived && !previousClient?.isArchived;
  const isRestoring = !updatedClient.isArchived && previousClient?.isArchived;
  setState((s) => ({
    ...s,
    clients: s.clients.map((client) => (client.id === id ? updatedClient : client)),
    enrollments: s.enrollments.map((enrollment) => {
      if (enrollment.clientId !== id) return enrollment;
      if (isArchiving && !enrollment.isArchived) {
        return {
          ...enrollment,
          isArchived: true,
          archivedAt: updatedClient.archivedAt ?? null,
        };
      }
      if (
        isRestoring
        && enrollment.isArchived
        && enrollment.archivedAt === previousClient?.archivedAt
      ) {
        return { ...enrollment, isArchived: false, archivedAt: null };
      }
      return enrollment;
    }),
  }));
  return delay(updatedClient);
}

export async function archiveClient(
  id: string,
  reason = "Archived by staff",
  finalStatus = "Archived",
) {
  await updateClient(id, {
    isArchived: true,
    status: "Archived",
    archiveReason: reason,
    finalStatus,
    archivedAt: nowISO(),
  });
  await log(id, "Client archived", reason);
  return delay(true);
}

export async function deleteClient(id: string) {
  await cfDeleteClient(id);
  setState((current) => ({
    ...current,
    clients: current.clients.filter((client) => client.id !== id),
  }));
  retryBootstrap();
}

export async function restoreClient(id: string) {
  await updateClient(id, { isArchived: false, status: "Active", archiveReason: undefined });
  await log(id, "Client restored", "Client restored to active caseload.");
  return delay(true);
}

/* --------------------------------- Programs --------------------------------- */

export const getPrograms = async () => delay(getState().programs);

export const getProgramDetail = (id: string) => cfGetProgramDetail(id);

export async function createProgram(data: Omit<Program, "id">) {
  const program = await cfCreateProgram(data as Record<string, unknown>);
  setState((s) => ({
    ...s,
    programs: [...s.programs, program],
    formTemplates: s.formTemplates.map((template) =>
      template.id === program.defaultFormTemplateId
        ? { ...template, programId: program.id, scope: "program_section" }
        : template,
    ),
  }));
  return delay(program);
}

export async function updateProgram(id: string, data: Partial<Program>) {
  const program = await cfUpdateProgram(id, data as Record<string, unknown>);
  setState((s) => ({
    ...s,
    programs: s.programs.map((p) => (p.id === id ? program : p)),
    formTemplates: s.formTemplates.map((template) =>
      template.id === program.defaultFormTemplateId
        ? { ...template, programId: program.id, scope: "program_section" }
        : template,
    ),
  }));
  return delay(program);
}

/* ---------------------------- Program Enrollments --------------------------- */

export async function createEnrollment(
  data: Pick<ProgramEnrollment, "clientId" | "programId"> &
    Partial<Pick<ProgramEnrollment, "status" | "assignedUserId" | "startDate">>,
) {
  const enrollment = await cfCreateEnrollment(data as Record<string, unknown>);
  setState((state) => ({ ...state, enrollments: [enrollment, ...state.enrollments] }));
  return enrollment;
}

export async function updateEnrollment(
  id: string,
  data: Partial<ProgramEnrollment> & { statusReason?: string },
) {
  const enrollment = await cfUpdateEnrollment(id, data as Record<string, unknown>);
  setState((state) => ({
    ...state,
    enrollments: state.enrollments.map((existing) => (existing.id === id ? enrollment : existing)),
  }));
  return enrollment;
}

export async function withdrawEnrollment(id: string, reason: string) {
  return updateEnrollment(id, { status: "withdrawn", statusReason: reason });
}

export async function reactivateEnrollment(id: string) {
  return updateEnrollment(id, {
    status: "active",
    statusReason: "Program membership reactivated.",
  });
}

/* ----------------------------------- Forms ---------------------------------- */

export const getFormTemplates = async () => delay(getState().formTemplates);

export async function createFormTemplate(data: Omit<FormTemplate, "id">) {
  const template = await cfCreateFormTemplate(data as Record<string, unknown>);
    setState((s) => ({ ...s, formTemplates: [...s.formTemplates, template] }));
  return delay(template);
}

export async function updateFormTemplate(id: string, data: Partial<FormTemplate>) {
  const template = await cfUpdateFormTemplate(id, data as Record<string, unknown>);
  setState((s) => ({
    ...s,
    formTemplates: s.formTemplates.map((t) => (t.id === id ? template : t)),
  }));
  return delay(template);
}

export async function deleteFormTemplate(id: string) {
  const deleted = await cfDeleteFormTemplate(id);
  const unlinkedProgramIds = new Set(deleted.unlinkedProgramIds);
  setState((s) => ({
    ...s,
    formTemplates: s.formTemplates.filter((template) => template.id !== deleted.id),
    programs: s.programs.map((program) =>
      unlinkedProgramIds.has(program.id)
        ? { ...program, defaultFormTemplateId: "", isActive: false }
        : program,
    ),
  }));
  return delay(deleted);
}

export async function assignFormToClient(clientId: string, formId: string, dueDate?: string) {
  const appOrigin =
    typeof window !== "undefined" ? window.location.origin : "https://clientflow-2g9.pages.dev";
  const assignment = await cfCreateFormAssignment({
    clientId,
    formId,
    status: "draft",
    completionMethod: "secure_link",
    deliveryMethod: "email",
    dueDate,
    secureLink: `${appOrigin}/s/${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
  });
  setState((s) => ({ ...s, formAssignments: [assignment, ...s.formAssignments] }));
  return delay(assignment);
}

export async function createFormAssignment(data: {
  clientId: string;
  formId: string;
  completionMethod: CompletionMethod;
  deliveryMethod: DeliveryMethod;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  assignedUserId?: string | null;
  dueDate?: string;
  status?: FormAssignmentStatus;
  organizationId?: string;
  isDemo?: boolean;
  personalMessage?: string;
}) {
  const isSendLink = data.completionMethod === "secure_link";
  const assignment = await cfCreateFormAssignment({
    clientId: data.clientId,
    formId: data.formId,
    completionMethod: data.completionMethod,
    deliveryMethod: data.deliveryMethod,
    recipientEmail: data.recipientEmail ?? null,
    recipientPhone: data.recipientPhone ?? null,
    assignedUserId: data.assignedUserId ?? null,
    dueDate: data.dueDate,
    status: "draft",
    isDemo: data.isDemo ?? false,
  });
  setState((s) => ({ ...s, formAssignments: [assignment, ...s.formAssignments] }));
  await log(
    data.clientId,
    "Form assigned",
    isSendLink
      ? `Secure link created for ${data.formId}.`
      : `Admin-assisted form opened for ${data.formId}.`,
  );
  return delay(assignment);
}

export async function convertProfile(id: string, newRelationshipType: RelationshipType = "client") {
  await updateClient(id, {
    relationshipType: newRelationshipType,
    lifecycleStatus: newRelationshipType === "client" ? "active" : undefined,
    convertedAt: nowISO(),
    status: newRelationshipType === "client" ? "Active" : undefined,
  });
  await log(id, "Profile converted", `Relationship type changed to ${newRelationshipType}.`);
  return delay(true);
}

export async function sendFormEmail(formAssignmentId: string, personalMessage?: string) {
  const assignment = await cfSendFormAssignment(formAssignmentId, {
    ...(personalMessage ? { personalMessage } : {}),
  });
  setState((s) => ({
    ...s,
    formAssignments: s.formAssignments.map((a) => (a.id === formAssignmentId ? assignment : a)),
  }));
  await log(
    assignment.clientId,
    "Form sent",
    `Secure form link emailed to ${assignment.recipientEmail ?? "the recipient"}.`,
  );
  return delay(assignment);
}

export async function submitFormResponse(
  formAssignmentId: string,
  responses: Record<string, PublicFormResponseValue>,
) {
  const submittedAt = nowISO();
  await cfUpdateFormAssignment(formAssignmentId, { status: "submitted", submittedAt, responses });
  setState((s) => ({
    ...s,
    formAssignments: s.formAssignments.map((a) =>
      a.id === formAssignmentId
        ? { ...a, status: "submitted" as const, submittedAt, responses }
        : a,
    ),
  }));
  return delay(true);
}

export async function cancelFormAssignment(id: string) {
  await cfUpdateFormAssignment(id, { status: "cancelled", cancelledAt: nowISO() });
  setState((s) => ({
    ...s,
    formAssignments: s.formAssignments.map((a) =>
      a.id === id ? { ...a, status: "cancelled" as const } : a,
    ),
  }));
  return delay(true);
}

export async function saveFormDraft(id: string, responses: Record<string, PublicFormResponseValue>) {
  await cfUpdateFormAssignment(id, { status: "in_progress", responses });
  setState((s) => ({
    ...s,
    formAssignments: s.formAssignments.map((a) =>
      a.id === id ? { ...a, status: "in_progress" as const, responses } : a,
    ),
  }));
  const assignment = getState().formAssignments.find((a) => a.id === id);
  if (assignment)
    await log(assignment.clientId, "Form draft saved", "Admin saved form responses as a draft.");
  return delay(true);
}

export async function changeAssignmentStatus(id: string, status: FormAssignmentStatus) {
  await cfUpdateFormAssignment(id, { status });
  setState((s) => ({
    ...s,
    formAssignments: s.formAssignments.map((a) => (a.id === id ? { ...a, status } : a)),
  }));
  const assignment = getState().formAssignments.find((a) => a.id === id);
  if (assignment)
    await log(
      assignment.clientId,
      "Form status changed",
      `Assignment status updated to ${status.replace(/_/g, " ")}.`,
    );
  return delay(true);
}

export async function saveFormEdits(
  id: string,
  newResponses: Record<string, PublicFormResponseValue>,
) {
  const s = getState();
  const assignment = s.formAssignments.find((a) => a.id === id);
  if (!assignment) return delay(false);

  const template = s.formTemplates.find((t) => t.id === assignment.formId);
  const oldResponses = assignment.responses ?? {};
  const allFieldIds = template
    ? template.fields.map((f) => f.id)
    : [...new Set([...Object.keys(oldResponses), ...Object.keys(newResponses)])];

  const changes = allFieldIds
    .filter(
      (fid) =>
        JSON.stringify(oldResponses[fid] ?? "") !== JSON.stringify(newResponses[fid] ?? ""),
    )
    .map((fid) => {
      const field = template?.fields.find((f) => f.id === fid);
      return {
        fieldId: fid,
        fieldLabel: field?.label ?? fid,
        oldValue: responseDisplayValue(oldResponses[fid]),
        newValue: responseDisplayValue(newResponses[fid]),
      };
    });

  if (changes.length === 0) return delay(true);

  const admin = getState().authenticatedAdmin;
  const editedBy = admin
    ? [admin.firstName, admin.lastName].filter(Boolean).join(" ") || admin.email
    : "Admin";

  const edit: FormEdit = { id: uid("fe"), editedAt: nowISO(), editedBy, changes };
  const nextHistory = [...(assignment.editHistory ?? []), edit];

  await cfUpdateFormAssignment(id, { responses: newResponses, editHistory: nextHistory });

  setState((s) => ({
    ...s,
    formAssignments: s.formAssignments.map((a) =>
      a.id === id ? { ...a, responses: newResponses, editHistory: nextHistory } : a,
    ),
  }));

  await log(
    assignment.clientId,
    "Form edited",
    `${editedBy} edited ${changes.length} field${changes.length !== 1 ? "s" : ""} on "${template?.name ?? id}".`,
    editedBy,
  );

  return delay(true);
}

function responseDisplayValue(value: PublicFormResponseValue | undefined): string {
  if (Array.isArray(value)) return value.join("\n") || "(empty)";
  return value === undefined || value === null || value === "" ? "(empty)" : String(value);
}

export const renderEmailBody = (vars: {
  contactName: string;
  programName: string;
  dueDate: string;
  secureFormLink: string;
}) =>
  emailTemplateBody
    .replace("{{contactName}}", vars.contactName)
    .replace("{{programName}}", vars.programName)
    .replace("{{dueDate}}", vars.dueDate)
    .replace("{{secureFormLink}}", vars.secureFormLink);

/* ----------------------------------- Terms ---------------------------------- */

export async function createTerms(clientId: string, data: Omit<Terms, "id" | "clientId">) {
  const backend = await cfCreateTerms(clientId, data as Record<string, unknown>);
  const terms: Terms = { ...data, id: backend.id, clientId };
  setState((s) => ({ ...s, terms: [terms, ...s.terms] }));
  await log(clientId, "Terms drafted", `${data.supportType} terms created.`);
  return delay(terms);
}

export async function updateTerms(termsId: string, data: Partial<Terms>) {
  await cfUpdateTerms(termsId, data as Record<string, unknown>);
  setState((s) => ({
    ...s,
    terms: s.terms.map((t) => (t.id === termsId ? { ...t, ...data } : t)),
  }));
  return delay(getState().terms.find((t) => t.id === termsId) ?? null);
}

/* --------------------------------- Contracts -------------------------------- */

export async function generateContract(clientId: string, termsId?: string) {
  const s = getState();
  const client = s.clients.find((c) => c.id === clientId);
  const program = s.programs.find((p) => p.id === client?.programId);
  const terms = s.terms.find((t) => t.id === termsId);
  const contract: Contract = {
    id: uid("ct"),
    clientId,
    programId: program?.id ?? "",
    termsId,
    contractType: program?.defaultContractTemplateId ?? "Service Agreement",
    status: "Draft",
    createdAt: nowISO(),
    content: buildContractContent(client?.businessName ?? "", program?.name ?? "", terms),
  };
  const backend = await cfCreateContract(clientId, {
    programId: program?.id ?? "",
    termsId,
    contractType: contract.contractType,
    status: contract.status,
    content: contract.content,
  });
  const finalContract: Contract = { ...contract, id: backend.id };
  setState((st) => ({ ...st, contracts: [finalContract, ...st.contracts] }));
  await log(clientId, "Contract generated", `${contract.contractType} draft created.`);
  return delay(finalContract);
}

export function buildContractContent(business: string, programName: string, terms?: Terms) {
  return `DRAFT AGREEMENT — NOT FINAL LEGAL LANGUAGE

This agreement is entered into between EA Management ("Provider") and ${business || "{{businessName}}"} ("Client") for participation in the ${programName || "{{programName}}"} program.

1. SCOPE OF SUPPORT
Provider will deliver the services and resources described as: ${terms?.resourceDescription || "{{resourceDescription}}"}.
Support type: ${terms?.supportType || "{{supportType}}"}.

2. FUNDING AND RESOURCES
Total commitment: $${(terms?.fundingAmount ?? 0).toLocaleString()}
Grant: $${(terms?.grantAmount ?? 0).toLocaleString()} · Loan: $${(terms?.loanAmount ?? 0).toLocaleString()} · Forgivable: $${(terms?.forgivableAmount ?? 0).toLocaleString()} · Investment: $${(terms?.investmentAmount ?? 0).toLocaleString()}
Repayment required: ${terms?.repaymentRequired ? "Yes" : "No"} — ${terms?.repaymentSchedule || "N/A"}
Interest: ${terms?.interestDescription || "N/A"}

3. TERM
Start: ${terms?.startDate ? terms.startDate.slice(0, 10) : "{{startDate}}"} · End: ${terms?.endDate ? terms.endDate.slice(0, 10) : "{{endDate}}"}

4. MILESTONES
${terms?.milestones || "{{milestones}}"}

5. REPORTING AND MONITORING
${terms?.reportingRequirements || "{{reportingRequirements}}"}
Monitoring frequency: ${terms?.monitoringFrequency || "{{monitoringFrequency}}"}

6. SPECIAL CONDITIONS
${terms?.specialConditions || "None"}

7. SIGNATURES
Client: ______________________   Date: __________
EA Management: ______________   Date: __________`;
}

export async function updateContract(id: string, data: Partial<Contract>) {
  await cfUpdateContract(id, data as Record<string, unknown>);
  setState((s) => ({
    ...s,
    contracts: s.contracts.map((c) => (c.id === id ? { ...c, ...data } : c)),
  }));
  return delay(true);
}

/* -------------------------------- Monitoring -------------------------------- */

export async function createEnrollmentMonitoring(
  enrollmentId: string,
  data: Pick<EnrollmentMonitoring, "name" | "frequency"> &
    Partial<
      Pick<
        EnrollmentMonitoring,
        | "description"
        | "customIntervalDays"
        | "expectedValue"
        | "unit"
        | "nextReviewAt"
        | "evidenceRequired"
        | "notes"
      >
    >,
) {
  const item = (await cfCreateEnrollmentMonitoring(
    enrollmentId,
    data as Record<string, unknown>,
  )) as EnrollmentMonitoring;
  setState((s) => ({ ...s, monitoring: [item, ...s.monitoring] }));
  return delay(item);
}

export async function recordMonitoringResult(
  id: string,
  data: Pick<EnrollmentMonitoring, "complianceStatus"> &
    Partial<
      Pick<
        EnrollmentMonitoring,
        "actualValue" | "expectedValue" | "unit" | "nextReviewAt" | "followUpRequired" | "notes"
      >
    >,
) {
  await cfRecordMonitoringResult(id, data as Record<string, unknown>);
  setState((s) => ({
    ...s,
    monitoring: s.monitoring.map((item) =>
      item.id === id
        ? {
            ...item,
            ...data,
            actualValue: data.actualValue ?? item.actualValue,
            lastReviewedAt: nowISO(),
          }
        : item,
    ),
  }));
  return delay(true);
}

/* ------------------------------- Final reports ------------------------------ */

export async function createFinalReport(clientId: string, data: FinalReportDraft) {
  const backend = await cfCreateFinalReport(clientId, data as Record<string, unknown>);
  const report: FinalReport = { ...data, id: backend.id, clientId };
  setState((s) => ({ ...s, finalReports: [report, ...s.finalReports] }));
  await log(clientId, "Final report completed", `Outcome recorded: ${data.clientOutcome}.`);
  return delay(report);
}

export async function archiveAfterFinalReport(clientId: string, decision: string) {
  return archiveClient(clientId, `Final report completed — ${decision}`, decision);
}

/* --------------------------- Documents / comms / log ------------------------- */

export async function uploadDocument(clientId: string, file: File) {
  const contentType = file.type || "application/octet-stream";
  const intent = await cfCreateDocumentUpload(clientId, {
    name: file.name,
    type: contentType,
    byteSize: file.size,
  });
  const uploadResponse = await fetch(intent.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: file,
  });
  if (!uploadResponse.ok) throw new Error("Document bytes could not be uploaded.");
  const doc = await cfCompleteDocumentUpload(intent.document.id);
  setState((s) => ({ ...s, documents: [doc, ...s.documents] }));
  return delay(doc);
}

export async function downloadDocument(documentId: string) {
  const result = await cfGetDocumentDownload(documentId);
  window.open(result.url, "_blank", "noopener,noreferrer");
}

export async function addCommunication(
  clientId: string,
  data: Omit<Communication, "id" | "clientId">,
) {
  const backend = await cfCreateCommunication(clientId, data as Record<string, unknown>);
  const comm: Communication = { ...data, id: backend.id, clientId };
  setState((s) => ({ ...s, communications: [comm, ...s.communications] }));
  await log(clientId, "Note added", data.subject);
  return delay(comm);
}

export const getActivityLog = async (clientId: string) =>
  delay(getState().activity.filter((a) => a.clientId === clientId));
