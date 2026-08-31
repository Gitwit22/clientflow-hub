import { clearAuthSession, setAuthSession } from "./store";
import type {
  ClientDocument,
  EnrollmentStatusHistory,
  FormAssignment,
  IntakeSubmission,
  OrgMember,
  OrgSettings,
  ProgramDetailResponse,
  ProgramEnrollment,
} from "@/types";

const API_URL =
  (import.meta.env.VITE_API_URL as string | undefined) ?? "https://nxt-lvl-api2.onrender.com";
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
  ) {
    super(message);
    this.name = "ApiError";
  }
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
    return new ApiError(response.status, code, message);
  } catch {
    return new ApiError(response.status, "PARSE_ERROR", response.statusText);
  }
}

// ─── Core request helper ─────────────────────────────────────────────────────

async function sendRequest(path: string, init: RequestInit): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      "X-App-Partition": APP_PARTITION,
      ...init.headers,
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
export async function login(
  payload: LoginPayload,
): Promise<{ admin: AdminInfo }> {
  const result = await apiRequest<{ admin: AdminInfo }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setAuthSession(result.admin);
  return result;
}

/** POST /auth/logout - revokes and clears the cookie session. */
export async function logout(): Promise<void> {
  try {
    await apiRequest("/api/v1/auth/logout", { method: "POST" });
  } finally {
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
  try {
    const admin = await apiRequest<AdminInfo>("/api/v1/auth/me");
    setAuthSession(admin);
    return true;
  } catch {
    clearAuthSession();
    return false;
  }
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

/** POST /auth/change-password — revokes all sessions; user must log in again. */
export async function changePassword(payload: ChangePasswordPayload): Promise<{ message: string }> {
  return apiRequest("/api/v1/auth/change-password", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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
  const result = await apiRequest<{ admin: AdminInfo }>(
    "/api/v1/auth/accept-invite",
    {
      method: "POST",
      body: JSON.stringify({ token, newPassword }),
    },
  );
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

export type PublicFormResponseValue = string | string[] | boolean | number | null;

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
  prefill: Record<string, string>;
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
  );
}

async function publicRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-App-Partition": APP_PARTITION,
      ...init.headers,
    },
  });
  if (!response.ok) {
    throw await parseApiError(response);
  }
  if (response.status === 204) return undefined as unknown as T;
  const body = (await response.json()) as T | { success: true; data: T };
  return body && typeof body === "object" && "success" in body && "data" in body ? body.data : body;
}

// ─── ClientFlow CRUD ──────────────────────────────────────────────────────────

const CF = "/api/v1/admin/cf";

export async function cfListClients() {
  return apiRequest<unknown[]>(`${CF}/clients`);
}
export async function cfGetClient(id: string) {
  return apiRequest<unknown>(`${CF}/clients/${id}`);
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

export async function cfListPrograms() {
  return apiRequest<unknown[]>(`${CF}/programs`);
}
export async function cfGetProgramDetail(id: string) {
  return apiRequest<ProgramDetailResponse>(`${CF}/programs/${encodeURIComponent(id)}/detail`);
}
export async function cfCreateProgram(data: Record<string, unknown>) {
  return apiRequest<unknown>(`${CF}/programs`, { method: "POST", body: JSON.stringify(data) });
}
export async function cfUpdateProgram(id: string, data: Record<string, unknown>) {
  return apiRequest<unknown>(`${CF}/programs/${id}`, {
    method: "PATCH",
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

export async function cfListFormTemplates() {
  return apiRequest<unknown[]>(`${CF}/form-templates`);
}
export async function cfCreateFormTemplate(data: Record<string, unknown>) {
  return apiRequest<{ id: string }>(`${CF}/form-templates`, {
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

export async function cfListFormAssignments(clientId?: string) {
  const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  return apiRequest<unknown[]>(`${CF}/form-assignments${qs}`);
}
export async function cfCreateFormAssignment(data: Record<string, unknown>) {
  return apiRequest<FormAssignment>(`${CF}/form-assignments`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfSendFormAssignment(id: string, data: { personalMessage?: string }) {
  return apiRequest<FormAssignment>(`${CF}/form-assignments/${id}/send`, {
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

export async function cfListTerms(clientId: string) {
  return apiRequest<unknown[]>(`${CF}/clients/${clientId}/terms`);
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
  return apiRequest<unknown[]>(`${CF}/terms`);
}

export async function cfListAllMonitoring() {
  return apiRequest<unknown[]>(`${CF}/monitoring`);
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
  return apiRequest<unknown[]>(`${CF}/clients/${clientId}/contracts`);
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
  return apiRequest<unknown[]>(`${CF}/contracts`);
}

export async function cfListDocuments(clientId: string) {
  return apiRequest<unknown[]>(`${CF}/clients/${clientId}/documents`);
}
export async function cfCreateDocumentUpload(
  clientId: string,
  data: { name: string; type: string; byteSize: number; enrollmentId?: string },
) {
  return apiRequest<{
    document: ClientDocument;
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
export async function cfListAllDocuments() {
  return apiRequest<unknown[]>(`${CF}/documents`);
}

export async function cfListCommunications(clientId: string) {
  return apiRequest<unknown[]>(`${CF}/clients/${clientId}/communications`);
}
export async function cfCreateCommunication(clientId: string, data: Record<string, unknown>) {
  return apiRequest<{ id: string }>(`${CF}/clients/${clientId}/communications`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfListAllCommunications() {
  return apiRequest<unknown[]>(`${CF}/communications`);
}

export async function cfListFinalReports(clientId: string) {
  return apiRequest<unknown[]>(`${CF}/clients/${clientId}/final-reports`);
}
export async function cfCreateFinalReport(clientId: string, data: Record<string, unknown>) {
  return apiRequest<{ id: string }>(`${CF}/clients/${clientId}/final-reports`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}
export async function cfListAllFinalReports() {
  return apiRequest<unknown[]>(`${CF}/final-reports`);
}

export async function cfListActivity(clientId?: string) {
  const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  return apiRequest<unknown[]>(`${CF}/activity${qs}`);
}
export async function cfCreateActivity(data: Record<string, unknown>) {
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
