import { clearAuthSession, setAuthSession } from "./store";
import {
  broadcastLogout,
  clearIdleSession,
  getLastActivityAt,
  isIdleSessionExpired,
  recordActivity,
} from "./idle-session";
import type {
  ActivityLog,
  Client,
  ClientDocument,
  Communication,
  Contract,
  EnrollmentStatusHistory,
  EnrollmentMonitoring,
  FinalReport,
  FormAssignment,
  FormTemplate,
  IntakeSubmission,
  OrgMember,
  OrgSettings,
  Program,
  ProgramDetailResponse,
  ProgramWorkflow,
  ProgramEnrollment,
  PublicFormResponseValue,
  Terms,
} from "@/types";

export type { PublicFormResponseValue } from "@/types";

const CLIENTFLOW_API_URL =
  (import.meta.env.VITE_CLIENTFLOW_API_URL as string | undefined) ?? "https://clientflow-vjqd.onrender.com";
const APP_PARTITION = "clientflow";

// ─── Error types ─────────────────────────────────────────────────────────────

export class SessionExpiredError extends Error {
  constructor() {
    super("Session expired. Please log in again.");
    this.name = "SessionExpiredError";
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function isStalePublicFormError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 409;
}

async function parseApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    const nestedError =
      body["error"] && typeof body["error"] === "object"
        ? (body["error"] as Record<string, unknown>)
        : undefined;
    const message =
      (nestedError?.["message"] as string | undefined) ??
      (body["message"] as string | undefined) ??
      response.statusText;
    const code =
      (nestedError?.["code"] as string | undefined) ??
      (typeof body["error"] === "string" ? body["error"] : undefined) ??
      "UNKNOWN";
    const requestId =
      (nestedError?.["requestId"] as string | undefined) ??
      response.headers.get("X-Request-Id") ??
      undefined;
    return new ApiError(response.status, code, message, requestId);
  } catch {
    return new ApiError(
      response.status,
      "PARSE_ERROR",
      response.statusText,
      response.headers.get("X-Request-Id") ?? undefined,
    );
  }
}

// ─── Core request helper ─────────────────────────────────────────────────────

async function sendRequest(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${CLIENTFLOW_API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...init.headers,
      "X-App-Partition": APP_PARTITION,
    },
  });
}

let refreshRequest: Promise<boolean> | null = null;

async function refreshCookies(): Promise<boolean> {
  if (!refreshRequest) {
    refreshRequest = sendRequest("/api/v1/auth/refresh", { method: "POST" })
      .then((response) => response.ok)
      .catch(() => false)
      .finally(() => {
        refreshRequest = null;
      });
  }
  return refreshRequest;
}

function canRefresh(path: string): boolean {
  return ![
    "/api/v1/auth/login",
    "/api/v1/auth/refresh",
    "/api/v1/auth/accept-invite",
    "/api/v1/auth/validate-invite",
  ].some((publicPath) => path.startsWith(publicPath));
}

export async function apiRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  let response = await sendRequest(path, init);

  if (response.status === 401 && canRefresh(path)) {
    if (await refreshCookies()) {
      response = await sendRequest(path, init);
    }
    if (response.status === 401) {
      clearAuthSession();
      throw new SessionExpiredError();
    }
  }

  if (!response.ok) {
    throw await parseApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  const body = (await response.json()) as T | { success: true; data: T };
  return body && typeof body === "object" && "success" in body && "data" in body ? body.data : body;
}

// ─── Auth endpoints ───────────────────────────────────────────────────────────

export interface LoginPayload {
  email: string;
  password: string;
}

export interface AdminInfo {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  platformRole?: string | null;
  role?: string;
  organizationId?: string;
  activeOrganization?: {
    id: string;
    name: string;
    role: string;
    status: string;
  } | null;
}

export interface BootstrapData {
  user: { id: string; email: string; displayName: string };
  platformRole: string | null;
  activeOrganization: {
    id: string;
    name: string;
    role: string;
    status: string;
  } | null;
  settings: {
    timezone: string;
    currency: string;
    environment: string;
    features: Record<string, boolean>;
  };
  permissions: string[];
}

/** POST /auth/login - the API establishes HttpOnly session cookies. */
export async function login(payload: LoginPayload): Promise<{ admin: AdminInfo }> {
  const result = await apiRequest<{ admin: AdminInfo }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  recordActivity();
  setAuthSession(result.admin);
  return result;
}

/** POST /auth/logout - revokes and clears the cookie session. */
export async function logout(): Promise<void> {
  try {
    await apiRequest("/api/v1/auth/logout", { method: "POST" });
  } finally {
    clearIdleSession();
    broadcastLogout();
    clearAuthSession();
  }
}

/**
 * POST /auth/refresh — reserved for a future refresh-token flow.
 */
export async function refreshSession(): Promise<{ ok: boolean }> {
  return apiRequest("/api/v1/auth/refresh", { method: "POST" });
}

/**
 * GET /auth/bootstrap — primary startup call.
 * Returns user context, active organization, settings, and resolved permissions.
 * Never pass org/permissions from frontend state — server resolves everything.
 */
export async function bootstrap(): Promise<BootstrapData> {
  return apiRequest("/api/v1/auth/bootstrap");
}

/** GET /auth/session — lightweight liveness check. Returns 401 if expired. */
export async function getSession(): Promise<{ valid: boolean }> {
  return apiRequest("/api/v1/auth/session");
}

export async function restoreSession(): Promise<boolean> {
  if (isIdleSessionExpired()) {
    try {
      await logout();
    } catch {
      // Local session state is cleared by logout even if the API is unavailable.
    }
    return false;
  }

  try {
    const admin = await apiRequest<AdminInfo>("/api/v1/auth/me");
    if (getLastActivityAt() === null) {
      recordActivity();
    }
    setAuthSession(admin);
    return true;
  } catch {
    clearAuthSession();
    return false;
  }
}

export async function updateProfile(payload: {
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
}): Promise<AdminInfo> {
  const admin = await apiRequest<AdminInfo>("/api/v1/auth/me", {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
  setAuthSession(admin);
  return admin;
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

/** POST /auth/change-password — revokes all sessions; user must log in again. */
export async function changePassword(payload: ChangePasswordPayload): Promise<{ message: string }> {
  const result = await apiRequest<{ message: string }>("/api/v1/auth/change-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  clearAuthSession();
  return result;
}

/** POST /auth/forgot-password */
export async function forgotPassword(email: string): Promise<{ message: string }> {
  return apiRequest("/api/v1/auth/forgot-password", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

// ─── Organization endpoints ───────────────────────────────────────────────────

export async function getOrganizationSettings(organizationId: string): Promise<OrgSettings> {
  return apiRequest(`/api/v1/organizations/${organizationId}/settings`);
}

export async function updateOrganizationSettings(
  organizationId: string,
  payload: {
    name?: string;
    replyToEmail?: string;
    defaultMonitoringFrequency?: string;
    notificationTemplateToggles?: {
      programInvite?: boolean;
      monitoringReminder?: boolean;
      contractDraft?: boolean;
      finalReport?: boolean;
    };
  },
): Promise<OrgSettings> {
  return apiRequest(`/api/v1/organizations/${organizationId}/settings`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export async function listMembers(organizationId: string): Promise<OrgMember[]> {
  return apiRequest(`/api/v1/organizations/${organizationId}/members`);
}

export async function getMember(organizationId: string, memberId: string): Promise<OrgMember> {
  return apiRequest(`/api/v1/organizations/${organizationId}/members/${memberId}`);
}

export interface InviteMemberPayload {
  email: string;
  firstName: string;
  lastName?: string;
  role?: "org_admin" | "reviewer";
}

export async function inviteMember(
  organizationId: string,
  payload: InviteMemberPayload,
): Promise<{ message: string }> {
  return apiRequest(`/api/v1/organizations/${organizationId}/invitations`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function revokeMemberInvite(
  organizationId: string,
  memberId: string,
): Promise<{ message: string }> {
  return apiRequest(`/api/v1/organizations/${organizationId}/invitations/${memberId}/revoke`, {
    method: "POST",
  });
}

export async function updateMemberRole(
  organizationId: string,
  memberId: string,
  role: "org_admin" | "reviewer",
): Promise<{ id: string; email: string; role: string }> {
  return apiRequest(`/api/v1/organizations/${organizationId}/members/${memberId}/role`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

export async function disableMember(
  organizationId: string,
  memberId: string,
): Promise<{ message: string }> {
  return apiRequest(`/api/v1/organizations/${organizationId}/members/${memberId}/disable`, {
    method: "POST",
  });
}

export async function enableMember(
  organizationId: string,
  memberId: string,
): Promise<{ message: string }> {
  return apiRequest(`/api/v1/organizations/${organizationId}/members/${memberId}/enable`, {
    method: "POST",
  });
}

// ─── Invite acceptance ────────────────────────────────────────────────────────

export async function validateInvite(
  token: string,
): Promise<{ valid: boolean; email?: string; firstName?: string; reason?: string }> {
  return apiRequest(`/api/v1/auth/validate-invite?token=${encodeURIComponent(token)}`);
}

export async function acceptInvite(
  token: string,
  newPassword: string,
): Promise<{ admin: AdminInfo }> {
  const result = await apiRequest<{ admin: AdminInfo }>("/api/v1/auth/accept-invite", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
  setAuthSession(result.admin);
  return result;
}

// ─── Public Form (unauthenticated) ───────────────────────────────────────────

export interface PublicFormField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
  helpText?: string;
}

export interface PublicFormSection {
  id: string;
  kind: "core" | "program";
  templateId: string;
  templateVersion: number;
  programId: string | null;
  title: string;
  description: string;
  fields: PublicFormField[];
}

export interface PublicFormData {
  assignment: { id: string; status: string; dueDate: string | null };
  form: { id: string; name: string; description: string; fields: PublicFormField[] };
  program: { name: string };
  contact: { name: string };
  prefill: Record<string, PublicFormResponseValue>;
  intakeConfiguration: {
    configurationToken: string;
    programs: Array<{ id: string; name: string }>;
    sections: PublicFormSection[];
  };
}

/** GET /public/form/:token — load form for a client (no auth). */
export async function getPublicForm(token: string): Promise<PublicFormData> {
  return publicRequest<PublicFormData>(`/api/v1/public/form/${encodeURIComponent(token)}`);
}

/** POST /public/form/:token/submit — submit responses (no auth). */
export async function submitPublicForm(
  token: string,
  payload: {
    coreResponses: Record<string, PublicFormResponseValue>;
    programResponses: Record<string, Record<string, PublicFormResponseValue>>;
    selectedProgramIds: string[];
    configurationToken: string;
    idempotencyKey: string;
    startedAt?: string;
  },
): Promise<{ success: boolean; enrollmentIds: string[] }> {
  return publicRequest<{ success: boolean; enrollmentIds: string[] }>(
    `/api/v1/public/form/${encodeURIComponent(token)}/submit`,
    { method: "POST", body: JSON.stringify(payload) },
    1,
  );
}

async function publicRequest<T = unknown>(
  path: string,
  init: RequestInit = {},
  maxTransientRetries = 0,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(`${CLIENTFLOW_API_URL}${path}`, {
        ...init,
        cache: init.cache ?? "no-store",
        headers: {
          "Content-Type": "application/json",
          "X-App-Partition": APP_PARTITION,
          ...init.headers,
        },
      });
    } catch (error) {
      if (attempt >= maxTransientRetries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      continue;
    }
    if (!response.ok) {
      const error = await parseApiError(response);
      if (response.status < 500 || attempt >= maxTransientRetries) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
      continue;
    }
    if (response.status === 204) return undefined as unknown as T;
    const body = (await response.json()) as T | { success: true; data: T };
    return body && typeof body === "object" && "success" in body && "data" in body
      ? body.data
      : body;
  }
}

// ─── ClientFlow CRUD ──────────────────────────────────────────────────────────

const CF = "/api/v1/admin/cf";
const MAX_PAGE_SIZE = 500;

async function listAllPages<T>(path: string): Promise<T[]> {
  const records: T[] = [];

  for (let offset = 0; ; offset += MAX_PAGE_SIZE) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await apiRequest<T[]>(
      `${path}${separator}limit=${MAX_PAGE_SIZE}&offset=${offset}`,
    );
    records.push(...page);

    if (page.length < MAX_PAGE_SIZE) return records;
  }
}

export async function cfListClients() {
  return apiRequest<Client[]>(`${CF}/clients`);
}
export async function cfGetClient(id: string) {
  return apiRequest<Client>(`${CF}/clients/${id}`);
}
export async function cfCreateClient(data: Record<string, unknown>) {
  return apiRequest<unknown>(`${CF}/clients`, { method: "POST", body: JSON.stringify(data) });
}
export async function cfUpdateClient(id: string, data: Record<string, unknown>) {
  return apiRequest<unknown>(`${CF}/clients/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
export async function cfDeleteClient(id: string) {
  return apiRequest<{ id: string; deleted: true }>(`${CF}/clients/${id}`, {
    method: "DELETE",
  });
}

export async function cfListPrograms() {
  return apiRequest<Program[]>(`${CF}/programs`);
}
export async function cfGetProgramDetail(id: string) {
  return apiRequest<ProgramDetailResponse>(`${CF}/programs/${encodeURIComponent(id)}/detail`);
}
export async function cfCreateProgram(data: Record<string, unknown>) {
  return apiRequest<Program>(`${CF}/programs`, { method: "POST", body: JSON.stringify(data) });
}
export async function cfUpdateProgram(id: string, data: Record<string, unknown>) {
  return apiRequest<Program>(`${CF}/programs/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
export async function cfGetProgramWorkflow(id: string) {
  return apiRequest<ProgramWorkflow>(`${CF}/programs/${encodeURIComponent(id)}/workflow`);
}
export async function cfUpdateProgramWorkflow(id: string, data: Record<string, unknown>) {
  return apiRequest<ProgramWorkflow>(`${CF}/programs/${encodeURIComponent(id)}/workflow`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
export async function cfCreateProgramWorkflowContractTemplate(
  programId: string,
  data: Record<string, unknown>,
) {
  return apiRequest<ProgramWorkflow>(`${CF}/programs/${encodeURIComponent(programId)}/workflow/contracts/templates`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfCreateProgramWorkflowContractVersion(
  programId: string,
  templateId: string,
  data: Record<string, unknown>,
) {
  return apiRequest<ProgramWorkflow>(`${CF}/programs/${encodeURIComponent(programId)}/workflow/contracts/templates/${encodeURIComponent(templateId)}/versions`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfCreateProgramWorkflowWelcomeTemplate(
  programId: string,
  data: Record<string, unknown>,
) {
  return apiRequest<ProgramWorkflow>(`${CF}/programs/${encodeURIComponent(programId)}/workflow/emails/templates`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfCreateProgramWorkflowWelcomeVersion(
  programId: string,
  templateId: string,
  data: Record<string, unknown>,
) {
  return apiRequest<ProgramWorkflow>(`${CF}/programs/${encodeURIComponent(programId)}/workflow/emails/templates/${encodeURIComponent(templateId)}/versions`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function cfListEnrollments(filters: { clientId?: string; programId?: string } = {}) {
  const params = new URLSearchParams();
  if (filters.clientId) params.set("clientId", filters.clientId);
  if (filters.programId) params.set("programId", filters.programId);
  const query = params.size ? `?${params.toString()}` : "";
  return apiRequest<ProgramEnrollment[]>(`${CF}/enrollments${query}`);
}
export async function cfGetEnrollment(id: string) {
  return apiRequest<ProgramEnrollment>(`${CF}/enrollments/${id}`);
}
export async function cfGetEnrollmentHistory(id: string) {
  return apiRequest<EnrollmentStatusHistory[]>(`${CF}/enrollments/${id}/history`);
}
export async function cfCreateEnrollment(data: Record<string, unknown>) {
  return apiRequest<ProgramEnrollment>(`${CF}/enrollments`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfUpdateEnrollment(id: string, data: Record<string, unknown>) {
  return apiRequest<ProgramEnrollment>(`${CF}/enrollments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
export async function cfTransitionEnrollment(id: string, data: Record<string, unknown>) {
  return apiRequest<ProgramEnrollment>(`${CF}/enrollments/${id}/transition`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function cfListFormTemplates() {
  return apiRequest<FormTemplate[]>(`${CF}/form-templates`);
}
export async function cfCreateFormTemplate(data: Record<string, unknown>) {
  return apiRequest<FormTemplate>(`${CF}/form-templates`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfUpdateFormTemplate(id: string, data: Record<string, unknown>) {
  return apiRequest<FormTemplate>(`${CF}/form-templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
export async function cfDeleteFormTemplate(id: string) {
  return apiRequest<{
    id: string;
    unlinkedProgramIds: string[];
    cancelledAssignments: number;
  }>(`${CF}/form-templates/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export async function cfListFormAssignments(clientId?: string) {
  const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  return apiRequest<FormAssignment[]>(`${CF}/form-assignments${qs}`);
}
export async function cfCreateFormAssignment(data: {
  clientId: string;
  enrollmentId?: string;
  formId: string;
  assignedUserId?: string | null;
  completionMethod?: string;
  deliveryMethod?: string;
  recipientEmail?: string | null;
  recipientPhone?: string | null;
  dueDate?: string;
  isDemo?: boolean;
}) {
  return apiRequest<FormAssignment>(`${CF}/form-assignments`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfSendFormAssignment(id: string, data: { personalMessage?: string }) {
  return apiRequest<{
    success: true;
    status: "SENT";
    message: string;
    provider: "N8N_GMAIL" | "RESEND";
    formId: string;
    recipientEmail: string;
    sentAt: string;
    assignment: FormAssignment;
  }>(`${CF}/form-assignments/${id}/send`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfUpdateFormAssignment(id: string, data: Record<string, unknown>) {
  return apiRequest<unknown>(`${CF}/form-assignments/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function cfListIntakeSubmissions(
  filters: { clientId?: string; programId?: string } = {},
) {
  const params = new URLSearchParams();
  if (filters.clientId) params.set("clientId", filters.clientId);
  if (filters.programId) params.set("programId", filters.programId);
  const query = params.size ? `?${params.toString()}` : "";
  return apiRequest<IntakeSubmission[]>(`${CF}/intake-submissions${query}`);
}
export async function cfGetIntakeSubmission(id: string) {
  return apiRequest<
    IntakeSubmission & {
      snapshot: { renderedSections: PublicFormSection[]; selectedProgramIds: string[] } | null;
      assignment: FormAssignment | null;
    }
  >(`${CF}/intake-submissions/${id}`);
}

export interface ClientflowNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  actionUrl: string | null;
  clientId: string | null;
  submissionId: string | null;
  readAt: string | null;
  createdAt: string;
}

export async function cfListNotifications(limit = 30) {
  return apiRequest<{ items: ClientflowNotification[]; unreadCount: number }>(
    `${CF}/notifications?limit=${limit}`,
  );
}

export async function cfMarkNotificationRead(id: string) {
  return apiRequest<{ id: string; read: true }>(`${CF}/notifications/${id}/read`, {
    method: "PATCH",
  });
}

export async function cfMarkAllNotificationsRead() {
  return apiRequest<{ updated: number }>(`${CF}/notifications/read-all`, {
    method: "PATCH",
  });
}

export async function cfListTerms(clientId: string) {
  return apiRequest<Terms[]>(`${CF}/clients/${clientId}/terms`);
}
export async function cfCreateTerms(clientId: string, data: Record<string, unknown>) {
  return apiRequest<{ id: string }>(`${CF}/clients/${clientId}/terms`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfUpdateTerms(id: string, data: Record<string, unknown>) {
  return apiRequest<unknown>(`${CF}/terms/${id}`, { method: "PATCH", body: JSON.stringify(data) });
}
export async function cfListAllTerms() {
  return listAllPages<Terms>(`${CF}/terms`);
}

export async function cfListAllMonitoring() {
  return apiRequest<EnrollmentMonitoring[]>(`${CF}/monitoring`);
}
export async function cfCreateEnrollmentMonitoring(
  enrollmentId: string,
  data: Record<string, unknown>,
) {
  return apiRequest<{ id: string }>(`${CF}/enrollments/${enrollmentId}/monitoring`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfRecordMonitoringResult(id: string, data: Record<string, unknown>) {
  return apiRequest<unknown>(`${CF}/enrollment-monitoring/${id}/results`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfGetMonitoringHistory(id: string) {
  return apiRequest<unknown[]>(`${CF}/enrollment-monitoring/${id}/history`);
}

export async function cfListContracts(clientId: string) {
  return apiRequest<Contract[]>(`${CF}/clients/${clientId}/contracts`);
}
export async function cfCreateContract(clientId: string, data: Record<string, unknown>) {
  return apiRequest<{ id: string }>(`${CF}/clients/${clientId}/contracts`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfUpdateContract(id: string, data: Record<string, unknown>) {
  return apiRequest<unknown>(`${CF}/contracts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}
export async function cfListAllContracts() {
  return listAllPages<Contract>(`${CF}/contracts`);
}

export async function cfListDocuments(clientId: string) {
  return apiRequest<ClientDocument[]>(`${CF}/clients/${clientId}/documents`);
}
export async function cfCreateDocumentUpload(
  clientId: string,
  data: { name: string; type: string; byteSize: number; enrollmentId?: string },
) {
  return apiRequest<{
    document: ClientDocument;
    storedFile: { id: string; status: string };
    uploadUrl: string;
    expiresInSeconds: number;
  }>(`${CF}/clients/${clientId}/documents/upload-intent`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfCompleteDocumentUpload(documentId: string) {
  return apiRequest<ClientDocument>(`${CF}/documents/${documentId}/complete-upload`, {
    method: "POST",
  });
}
export async function cfGetDocumentDownload(documentId: string) {
  return apiRequest<{ url: string; expiresInSeconds: number }>(
    `${CF}/documents/${documentId}/download`,
  );
}
export async function cfCreateStoredFileUpload(
  data: { name: string; type: string; byteSize: number; storageKeyPrefix?: string },
) {
  return apiRequest<{
    storedFile: {
      id: string;
      organizationId: string;
      storageKey: string;
      originalFileName: string;
      mimeType: string;
      sizeBytes: number;
      status: string;
      uploadedByUserId?: string | null;
      createdAt: string;
      completedAt?: string | null;
    };
    uploadUrl: string;
    expiresInSeconds: number;
  }>(`${CF}/files/upload-intent`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfCompleteStoredFileUpload(fileId: string) {
  return apiRequest<{ id: string; status: string; completedAt?: string | null }>(
    `${CF}/files/${fileId}/complete`,
    { method: "POST" },
  );
}
export async function cfGetStoredFileDownload(fileId: string) {
  return apiRequest<{ url: string; expiresInSeconds: number }>(`${CF}/files/${fileId}/download`);
}
export async function cfListAllDocuments() {
  return listAllPages<ClientDocument>(`${CF}/documents`);
}

export async function cfListCommunications(clientId: string) {
  return apiRequest<Communication[]>(`${CF}/clients/${clientId}/communications`);
}
export async function cfCreateCommunication(clientId: string, data: Record<string, unknown>) {
  return apiRequest<{ id: string }>(`${CF}/clients/${clientId}/communications`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfListAllCommunications() {
  return listAllPages<Communication>(`${CF}/communications`);
}

export async function cfListFinalReports(clientId: string) {
  return apiRequest<FinalReport[]>(`${CF}/clients/${clientId}/final-reports`);
}
export async function cfCreateFinalReport(clientId: string, data: Record<string, unknown>) {
  return apiRequest<{ id: string }>(`${CF}/clients/${clientId}/final-reports`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfListAllFinalReports() {
  return listAllPages<FinalReport>(`${CF}/final-reports`);
}

export async function cfListActivity(clientId?: string) {
  const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  return apiRequest<ActivityLog[]>(`${CF}/activity${qs}`);
}
export async function cfCreateActivity(data: {
  clientId: string;
  enrollmentId?: string;
  action: string;
  description: string;
}) {
  return apiRequest<unknown>(`${CF}/activity`, { method: "POST", body: JSON.stringify(data) });
}

export async function cfSeedDemo() {
  return apiRequest<{ seeded: Record<string, number>; liveMode: boolean }>(`${CF}/seed-demo`, {
    method: "POST",
  });
}

export interface DemoStatus {
  liveMode: boolean;
  demoRemovedAt: string | null;
  principalAdminId: string | null;
}

export async function cfGetDemoStatus() {
  return apiRequest<DemoStatus>(`${CF}/demo-status`);
}

export interface LiveModeTransitionResult {
  liveMode: true;
  demoRemovedAt: string | null;
  principalAdminId: string | null;
  removed: Record<string, number>;
}

export async function cfRemoveDemo(payload: { currentPassword: string; confirmation: string }) {
  return apiRequest<LiveModeTransitionResult>(`${CF}/remove-demo`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ─── Automated workflow (intake → program rule → contract) ─────────────────

export type AutomatedClientStatus =
  | "INTAKE_SENT"
  | "INTAKE_SUBMITTED"
  | "PROGRAM_SELECTED"
  | "PENDING_STAFF_REVIEW"
  | "REVIEW_DECLINED"
  | "CONTRACT_SENT"
  | "CONTRACT_OPENED"
  | "ONBOARDING";

export interface AutomatedClient {
  id: string;
  organizationId: string;
  contactName: string;
  businessName: string;
  email: string;
  phone: string;
  programId: string | null;
  status: AutomatedClientStatus | string;
  assignedStaff: string;
  assignedUserId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AutomatedClientDetail extends AutomatedClient {
  program: { id: string; name: string } | null;
  contract: {
    id: string;
    status: string;
    contractType: string;
    sentAt: string | null;
    completedAt: string | null;
    staffSignedByName: string | null;
    staffSignedAt: string | null;
    signedName: string | null;
    signedEmail: string | null;
    /** The fully executed document (both signatures) once the client has signed. */
    content: string | null;
    /** R2-hosted download link for the archived executed document, once storage archival succeeds. */
    documentUrl: string | null;
  } | null;
  monitoringTask: { id: string; type: string; status: string; dueDate: string } | null;
}

export interface CreateAutomatedClientPayload {
  organizationId: string;
  contactName: string;
  businessName?: string;
  email: string;
  phone?: string;
  intakeSource?: string;
  assignedStaffId?: string;
  sendIntakeImmediately?: boolean;
}

/** POST /clients — creates a client and auto-sends (or defers) the General Intake form. */
export async function acfCreateClient(payload: CreateAutomatedClientPayload) {
  return apiRequest<{
    client: AutomatedClient;
    assignment: { id: string; formName: string; status: string; dueDate: string | null };
    publicFormUrl: string;
    emailDelivery: { status: string; reason?: string; sentAt?: string };
  }>("/api/v1/clients", { method: "POST", body: JSON.stringify(payload) });
}

/** GET /clients — list clients for an organization, optionally filtered by status. */
export async function acfListClients(organizationId: string, status?: string) {
  const params = new URLSearchParams({ organizationId, ...(status ? { status } : {}) });
  return apiRequest<AutomatedClient[]>(`/api/v1/clients?${params.toString()}`);
}

/** GET /clients/:id — client detail with current program, contract and monitoring task. */
export async function acfGetClient(id: string) {
  return apiRequest<AutomatedClientDetail>(`/api/v1/clients/${encodeURIComponent(id)}`);
}

/** PATCH /clients/:id/program — corrects the selected program and re-runs the contract rule engine. */
export async function acfUpdateClientProgram(id: string, programId: string) {
  return apiRequest<{
    nextAction: "STAFF_REVIEW_REQUIRED" | "CONTRACT_SENT";
    clientStatus: string;
    program: { id: string; name: string };
  }>(`/api/v1/clients/${encodeURIComponent(id)}/program`, {
    method: "PATCH",
    body: JSON.stringify({ programId }),
  });
}

/** POST /clients/:id/intake/send — sends a previously deferred intake email. */
export async function acfSendIntakeNow(id: string) {
  return apiRequest<{ emailDelivery: { status: string; reason?: string } }>(
    `/api/v1/clients/${encodeURIComponent(id)}/intake/send`,
    { method: "POST" },
  );
}

/** POST /clients/:id/review/approve — signs for the org and issues the contract for a pending-staff-review client. */
export async function acfApproveReview(
  id: string,
  staffSigner: { staffSignerName: string; staffSignerId?: string },
) {
  return apiRequest<{
    nextAction: "CONTRACT_SENT";
    clientStatus: string;
    program: { id: string; name: string };
    contract: { id: string; status: string; contractName: string };
    publicContractUrl: string;
    emailDelivery: { status: string; reason?: string };
  }>(`/api/v1/clients/${encodeURIComponent(id)}/review/approve`, {
    method: "POST",
    body: JSON.stringify(staffSigner),
  });
}

/** POST /clients/:id/review/decline — declines a pending-staff-review client without a contract. */
export async function acfDeclineReview(id: string, reason?: string) {
  return apiRequest<{ client: { id: string; status: string } }>(
    `/api/v1/clients/${encodeURIComponent(id)}/review/decline`,
    { method: "POST", body: JSON.stringify({ reason }) },
  );
}

export interface AutomatedPublicIntakeData {
  client: { contactName: string; businessName: string; email: string; phone: string };
  form: { id: string; name: string; description: string; fields: PublicFormField[] };
  assignment: { status: string; dueDate: string | null };
}

/** GET /public/forms/:token — load the automated General Intake form (no auth). */
export async function acfGetPublicIntakeForm(token: string) {
  return apiRequest<AutomatedPublicIntakeData>(
    `/api/v1/public/forms/${encodeURIComponent(token)}`,
  );
}

/** POST /public/forms/:token/submit — submit the automated General Intake form (no auth). */
export async function acfSubmitPublicIntakeForm(
  token: string,
  answers: Record<string, PublicFormResponseValue>,
) {
  return apiRequest<{
    success: boolean;
    status: string;
    selectedProgram: string | null;
    program: { id: string; name: string } | null;
    nextAction: "STAFF_REVIEW_REQUIRED" | "CONTRACT_SENT" | null;
  }>(`/api/v1/public/forms/${encodeURIComponent(token)}/submit`, {
    method: "POST",
    body: JSON.stringify({ answers }),
  });
}

export interface AutomatedPublicContractData {
  contract: { id: string; status: string; contractName: string; content: string; expiresAt: string | null };
  client: { name: string };
  program: { id: string; name: string };
}

/** GET /public/contracts/:token — load the generated contract for signature (no auth). */
export async function acfGetPublicContract(token: string) {
  return apiRequest<AutomatedPublicContractData>(
    `/api/v1/public/contracts/${encodeURIComponent(token)}`,
  );
}

/** POST /public/contracts/:token — accept and sign the contract (no auth). */
export async function acfAcceptPublicContract(
  token: string,
  payload: { signedName: string; signedEmail: string; agreedToTerms: true; signatureNote?: string },
) {
  return apiRequest<{
    contract: { id: string; status: string; completedAt: string };
    client: { id: string; status: string };
  }>(`/api/v1/public/contracts/${encodeURIComponent(token)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export interface AutomatedContractSummary {
  id: string;
  organizationId: string;
  clientId: string;
  programId: string;
  contractTemplateId: string;
  contractName: string;
  status: string;
  secureTokenExpiresAt: string | null;
  sentAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** POST /clients/:id/contracts/generate — manually draft a contract for the client's selected program. */
export async function acfGenerateContract(
  clientId: string,
  staffSigner: { staffSignerName?: string; staffSignerId?: string } = {},
) {
  return apiRequest<{ contract: AutomatedContractSummary; publicContractUrl: string }>(
    `/api/v1/clients/${encodeURIComponent(clientId)}/contracts/generate`,
    { method: "POST", body: JSON.stringify(staffSigner) },
  );
}

/** POST /clients/:id/contracts/send — issue and send an existing draft contract. */
export async function acfSendContract(clientId: string, contractId: string) {
  return apiRequest<{
    contract: AutomatedContractSummary;
    publicContractUrl: string;
    emailDelivery: { status: string; reason?: string };
  }>(`/api/v1/clients/${encodeURIComponent(clientId)}/contracts/send`, {
    method: "POST",
    body: JSON.stringify({ contractId }),
  });
}
