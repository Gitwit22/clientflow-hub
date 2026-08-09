/**
 * API service layer.
 *
 * Every function is async and returns a promise so the UI can be swapped from
 * the in-memory mock store to a real backend (Lovable Cloud / Supabase,
 * Firebase, Appwrite, Node/Express) without touching components.
 */
import { getState, setState, uid } from "./store";
import { emailTemplateBody } from "@/data/mock";
import { sendFormEmail as apiSendFormEmail } from "./apiClient";
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
  MonitoringItem,
  Program,
  RelationshipType,
  Terms,
} from "@/types";

const delay = <T>(value: T) => new Promise<T>((resolve) => setTimeout(() => resolve(value), 120));

const nowISO = () => new Date().toISOString();

function log(clientId: string, action: string, description: string, user = "Alicia Monroe") {
  const entry: ActivityLog = {
    id: uid("al"),
    clientId,
    action,
    description,
    user,
    timestamp: nowISO(),
  };
  setState((s) => ({ ...s, activity: [entry, ...s.activity] }));
}

/* ---------------------------------- Clients --------------------------------- */

export const getClients = async () => delay(getState().clients);

export const getClientById = async (id: string) =>
  delay(getState().clients.find((c) => c.id === id) ?? null);

export async function createClient(
  data: Omit<Client, "id" | "createdAt" | "updatedAt" | "isArchived">,
) {
  const client: Client = {
    ...data,
    id: uid("cl"),
    createdAt: nowISO(),
    updatedAt: nowISO(),
    isArchived: false,
  };
  setState((s) => ({ ...s, clients: [client, ...s.clients] }));
  log(client.id, "Intake received", `New intake created for ${client.businessName}.`);
  return delay(client);
}

export async function updateClient(id: string, data: Partial<Client>) {
  setState((s) => ({
    ...s,
    clients: s.clients.map((c) => (c.id === id ? { ...c, ...data, updatedAt: nowISO() } : c)),
  }));
  return delay(getState().clients.find((c) => c.id === id) ?? null);
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
  log(id, "Client archived", reason);
  return delay(true);
}

export async function restoreClient(id: string) {
  await updateClient(id, { isArchived: false, status: "Active", archiveReason: undefined });
  log(id, "Client restored", "Client restored to active caseload.");
  return delay(true);
}

/* --------------------------------- Programs --------------------------------- */

export const getPrograms = async () => delay(getState().programs);

export async function createProgram(data: Omit<Program, "id">) {
  const program: Program = { ...data, id: uid("prog") };
  setState((s) => ({ ...s, programs: [...s.programs, program] }));
  return delay(program);
}

export async function updateProgram(id: string, data: Partial<Program>) {
  setState((s) => ({
    ...s,
    programs: s.programs.map((p) => (p.id === id ? { ...p, ...data } : p)),
  }));
  return delay(getState().programs.find((p) => p.id === id) ?? null);
}

/* ----------------------------------- Forms ---------------------------------- */

export const getFormTemplates = async () => delay(getState().formTemplates);

export async function assignFormToClient(clientId: string, formId: string, dueDate?: string) {
  const assignment: FormAssignment = {
    id: uid("fa"),
    clientId,
    formId,
    status: "draft",
    completionMethod: "secure_link",
    deliveryMethod: "email",
    dueDate,
    secureLink: `https://forms.clientflow.app/s/${Math.random().toString(16).slice(2, 8)}`,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
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
  createdByUserId?: string;
  personalMessage?: string;
}) {
  const isSendLink = data.completionMethod === "secure_link";
  const assignment: FormAssignment = {
    id: uid("fa"),
    organizationId: data.organizationId,
    clientId: data.clientId,
    profileId: data.clientId,
    formId: data.formId,
    assignedUserId: data.assignedUserId ?? null,
    completionMethod: data.completionMethod,
    deliveryMethod: data.deliveryMethod,
    recipientEmail: data.recipientEmail ?? null,
    recipientPhone: data.recipientPhone ?? null,
    status: data.status ?? (isSendLink ? "sent" : "draft"),
    dueDate: data.dueDate,
    dueAt: data.dueDate ?? null,
    sentAt: isSendLink ? nowISO() : undefined,
    secureLink: isSendLink
      ? `https://forms.clientflow.app/s/${Math.random().toString(16).slice(2, 8)}`
      : undefined,
    createdByUserId: data.createdByUserId ?? "user_alicia",
    isDemo: data.isDemo ?? false,
    createdAt: nowISO(),
    updatedAt: nowISO(),
  };
  setState((s) => ({ ...s, formAssignments: [assignment, ...s.formAssignments] }));
  log(
    data.clientId,
    "Form assigned",
    isSendLink
      ? `Secure link sent for ${data.formId}.`
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
  log(id, "Profile converted", `Relationship type changed to ${newRelationshipType}.`);
  return delay(true);
}

export async function sendFormEmail(formAssignmentId: string, personalMessage?: string) {
  const s = getState();
  const assignment = s.formAssignments.find((a) => a.id === formAssignmentId);
  if (assignment?.secureLink) {
    const client = s.clients.find((c) => c.id === assignment.clientId);
    const template = s.formTemplates.find((t) => t.id === assignment.formId);
    const program = s.programs.find((p) => p.id === template?.programId);
    if (client && template) {
      // Fire-and-forget — store update proceeds regardless of email delivery
      apiSendFormEmail({
        to: assignment.recipientEmail ?? client.email,
        contactName: client.primaryContactName,
        formName: template.name,
        programName: program?.name ?? "EA Management Program",
        dueDate: assignment.dueDate
          ? new Date(assignment.dueDate).toLocaleDateString()
          : "As soon as possible",
        secureLink: assignment.secureLink,
        ...(personalMessage ? { personalMessage } : {}),
      }).catch(() => undefined);
      log(
        assignment.clientId,
        "Form sent",
        `Secure form link emailed to ${assignment.recipientEmail ?? client.email}.`,
      );
    }
  }
  setState((s) => ({
    ...s,
    formAssignments: s.formAssignments.map((a) =>
      a.id === formAssignmentId ? { ...a, status: "sent" as const, sentAt: nowISO() } : a,
    ),
  }));
  return delay(true);
}

export async function submitFormResponse(
  formAssignmentId: string,
  responses: Record<string, string>,
) {
  setState((s) => ({
    ...s,
    formAssignments: s.formAssignments.map((a) =>
      a.id === formAssignmentId
        ? { ...a, status: "submitted" as const, submittedAt: nowISO(), responses }
        : a,
    ),
  }));
  return delay(true);
}

export async function cancelFormAssignment(id: string) {
  setState((s) => ({
    ...s,
    formAssignments: s.formAssignments.map((a) =>
      a.id === id ? { ...a, status: "cancelled" as const } : a,
    ),
  }));
  return delay(true);
}

export async function saveFormDraft(id: string, responses: Record<string, string>) {
  setState((s) => ({
    ...s,
    formAssignments: s.formAssignments.map((a) =>
      a.id === id ? { ...a, status: "in_progress" as const, responses } : a,
    ),
  }));
  const assignment = getState().formAssignments.find((a) => a.id === id);
  if (assignment)
    log(assignment.clientId, "Form draft saved", "Admin saved form responses as a draft.");
  return delay(true);
}

export async function changeAssignmentStatus(id: string, status: FormAssignmentStatus) {
  setState((s) => ({
    ...s,
    formAssignments: s.formAssignments.map((a) => (a.id === id ? { ...a, status } : a)),
  }));
  const assignment = getState().formAssignments.find((a) => a.id === id);
  if (assignment)
    log(
      assignment.clientId,
      "Form status changed",
      `Assignment status updated to ${status.replace(/_/g, " ")}.`,
    );
  return delay(true);
}

export async function saveFormEdits(id: string, newResponses: Record<string, string>) {
  const s = getState();
  const assignment = s.formAssignments.find((a) => a.id === id);
  if (!assignment) return delay(false);

  const template = s.formTemplates.find((t) => t.id === assignment.formId);
  const oldResponses = assignment.responses ?? {};
  const allFieldIds = template
    ? template.fields.map((f) => f.id)
    : [...new Set([...Object.keys(oldResponses), ...Object.keys(newResponses)])];

  const changes = allFieldIds
    .filter((fid) => (oldResponses[fid] ?? "") !== (newResponses[fid] ?? ""))
    .map((fid) => {
      const field = template?.fields.find((f) => f.id === fid);
      return {
        fieldId: fid,
        fieldLabel: field?.label ?? fid,
        oldValue: oldResponses[fid] ?? "(empty)",
        newValue: newResponses[fid] ?? "(empty)",
      };
    });

  if (changes.length === 0) return delay(true);

  const admin = getState().authenticatedAdmin;
  const editedBy = admin
    ? [admin.firstName, admin.lastName].filter(Boolean).join(" ") || admin.email
    : "Admin";

  const edit: FormEdit = { id: uid("fe"), editedAt: nowISO(), editedBy, changes };

  setState((s) => ({
    ...s,
    formAssignments: s.formAssignments.map((a) =>
      a.id === id
        ? { ...a, responses: newResponses, editHistory: [...(a.editHistory ?? []), edit] }
        : a,
    ),
  }));

  log(
    assignment.clientId,
    "Form edited",
    `${editedBy} edited ${changes.length} field${changes.length !== 1 ? "s" : ""} on "${template?.name ?? id}".`,
    editedBy,
  );

  return delay(true);
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
  const terms: Terms = { ...data, id: uid("tm"), clientId };
  setState((s) => ({ ...s, terms: [terms, ...s.terms] }));
  log(clientId, "Terms drafted", `${data.supportType} terms created.`);
  return delay(terms);
}

export async function updateTerms(termsId: string, data: Partial<Terms>) {
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
  setState((st) => ({ ...st, contracts: [contract, ...st.contracts] }));
  log(clientId, "Contract generated", `${contract.contractType} draft created.`);
  return delay(contract);
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
  setState((s) => ({
    ...s,
    contracts: s.contracts.map((c) => (c.id === id ? { ...c, ...data } : c)),
  }));
  return delay(true);
}

/* -------------------------------- Monitoring -------------------------------- */

export async function createMonitoringItem(data: Omit<MonitoringItem, "id">) {
  const item: MonitoringItem = { ...data, id: uid("mo") };
  setState((s) => ({ ...s, monitoring: [item, ...s.monitoring] }));
  return delay(item);
}

export async function completeMonitoringItem(id: string) {
  setState((s) => ({
    ...s,
    monitoring: s.monitoring.map((m) =>
      m.id === id ? { ...m, status: "Completed", completedAt: nowISO() } : m,
    ),
  }));
  return delay(true);
}

export async function rescheduleMonitoringItem(id: string, dueDate: string) {
  setState((s) => ({
    ...s,
    monitoring: s.monitoring.map((m) => (m.id === id ? { ...m, dueDate, status: "Scheduled" } : m)),
  }));
  return delay(true);
}

/* ------------------------------- Final reports ------------------------------ */

export async function createFinalReport(clientId: string, data: FinalReportDraft) {
  const report: FinalReport = { ...data, id: uid("fr"), clientId };
  setState((s) => ({ ...s, finalReports: [report, ...s.finalReports] }));
  log(clientId, "Final report completed", `Outcome recorded: ${data.clientOutcome}.`);
  return delay(report);
}

export async function archiveAfterFinalReport(clientId: string, decision: string) {
  return archiveClient(clientId, `Final report completed — ${decision}`, decision);
}

/* --------------------------- Documents / comms / log ------------------------- */

export async function uploadDocument(clientId: string, file: { name: string; type: string }) {
  const doc: ClientDocument = {
    id: uid("doc"),
    clientId,
    name: file.name,
    type: file.type,
    url: "#",
    uploadedAt: nowISO(),
    uploadedBy: "Alicia Monroe",
  };
  setState((s) => ({ ...s, documents: [doc, ...s.documents] }));
  return delay(doc);
}

export async function addCommunication(
  clientId: string,
  data: Omit<Communication, "id" | "clientId">,
) {
  const comm: Communication = { ...data, id: uid("cm"), clientId };
  setState((s) => ({ ...s, communications: [comm, ...s.communications] }));
  log(clientId, "Note added", data.subject);
  return delay(comm);
}

export const getActivityLog = async (clientId: string) =>
  delay(getState().activity.filter((a) => a.clientId === clientId));
