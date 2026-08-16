import { clearAccessToken, getState, setAuthSession } from "./store";
import type { OrgMember, OrgSettings } from "@/types";

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
    const message = (body["message"] as string | undefined) ?? response.statusText;
    const code = (body["error"] as string | undefined) ?? "UNKNOWN";
    return new ApiError(response.status, code, message);
  } catch {
    return new ApiError(response.status, "PARSE_ERROR", response.statusText);
  }
}

// ─── Core request helper ─────────────────────────────────────────────────────

export async function apiRequest<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const accessToken = getState().accessToken;
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      "X-App-Partition": APP_PARTITION,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      ...init.headers,
    },
  });

  if (response.status === 401 && path !== "/api/v1/auth/login") {
    clearAccessToken();
    throw new SessionExpiredError();
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

/** POST /auth/login — stores the returned Bearer token in memory. */
export async function login(
  payload: LoginPayload,
): Promise<{ accessToken: string; admin: AdminInfo }> {
  const result = await apiRequest<{ accessToken: string; admin: AdminInfo }>("/api/v1/auth/login", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  setAuthSession(result.accessToken, result.admin);
  return result;
}

/** POST /auth/logout — clears the in-memory Bearer token. */
export async function logout(): Promise<void> {
  try {
    await apiRequest("/api/v1/auth/logout", { method: "POST" });
  } finally {
    clearAccessToken();
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
  payload: { name?: string; replyToEmail?: string; defaultMonitoringFrequency?: string },
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

export async function inviteMember(organizationId: string, payload: InviteMemberPayload): Promise<{ message: string }> {
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

export async function disableMember(organizationId: string, memberId: string): Promise<{ message: string }> {
  return apiRequest(`/api/v1/organizations/${organizationId}/members/${memberId}/disable`, {
    method: "POST",
  });
}

export async function enableMember(organizationId: string, memberId: string): Promise<{ message: string }> {
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
): Promise<{ accessToken: string; admin: AdminInfo }> {
  const result = await apiRequest<{ accessToken: string; admin: AdminInfo }>("/api/v1/auth/accept-invite", {
    method: "POST",
    body: JSON.stringify({ token, newPassword }),
  });
  setAuthSession(result.accessToken, result.admin);
  return result;
}

// ─── Form assignment email ────────────────────────────────────────────────────

export interface SendFormEmailPayload {
  to: string;
  contactName: string;
  formName: string;
  programName: string;
  dueDate: string;
  secureLink: string;
  personalMessage?: string;
}

/** POST /admin/form-assignments/send-email — delivers the secure form link via Resend. */
export async function sendFormEmail(payload: SendFormEmailPayload): Promise<void> {
  return apiRequest("/api/v1/admin/form-assignments/send-email", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ─── Public Form (unauthenticated) ───────────────────────────────────────────

export interface PublicFormField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  options?: string[];
}

export interface PublicFormData {
  assignment: { id: string; status: string; dueDate: string | null };
  form: { id: string; name: string; description: string; fields: PublicFormField[] };
  program: { name: string };
  contact: { name: string };
  prefill: Record<string, string>;
}

/** GET /public/form/:token — load form for a client (no auth). */
export async function getPublicForm(token: string): Promise<PublicFormData> {
  return publicRequest<PublicFormData>(`/api/v1/public/form/${encodeURIComponent(token)}`);
}

/** POST /public/form/:token/submit — submit responses (no auth). */
export async function submitPublicForm(
  token: string,
  payload: { responses: Record<string, string>; startedAt?: string },
): Promise<{ success: boolean }> {
  return publicRequest<{ success: boolean }>(
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
  return body && typeof body === "object" && "success" in body && "data" in body
    ? body.data
    : body;
}

// ─── ClientFlow CRUD ──────────────────────────────────────────────────────────

const CF = "/api/v1/admin/cf";

export async function cfListClients() { return apiRequest<unknown[]>(`${CF}/clients`); }
export async function cfGetClient(id: string) { return apiRequest<unknown>(`${CF}/clients/${id}`); }
export async function cfCreateClient(data: Record<string, unknown>) { return apiRequest<unknown>(`${CF}/clients`, { method: "POST", body: JSON.stringify(data) }); }
export async function cfUpdateClient(id: string, data: Record<string, unknown>) { return apiRequest<unknown>(`${CF}/clients/${id}`, { method: "PATCH", body: JSON.stringify(data) }); }

export async function cfListPrograms() { return apiRequest<unknown[]>(`${CF}/programs`); }
export async function cfCreateProgram(data: Record<string, unknown>) { return apiRequest<unknown>(`${CF}/programs`, { method: "POST", body: JSON.stringify(data) }); }
export async function cfUpdateProgram(id: string, data: Record<string, unknown>) { return apiRequest<unknown>(`${CF}/programs/${id}`, { method: "PATCH", body: JSON.stringify(data) }); }

export async function cfListFormTemplates() { return apiRequest<unknown[]>(`${CF}/form-templates`); }
export async function cfCreateFormTemplate(data: Record<string, unknown>) { return apiRequest<{ id: string }>(`${CF}/form-templates`, { method: "POST", body: JSON.stringify(data) }); }
export async function cfUpdateFormTemplate(id: string, data: Record<string, unknown>) { return apiRequest<{ id: string }>(`${CF}/form-templates/${id}`, { method: "PATCH", body: JSON.stringify(data) }); }

export async function cfListFormAssignments(clientId?: string) {
  const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  return apiRequest<unknown[]>(`${CF}/form-assignments${qs}`);
}
export async function cfCreateFormAssignment(data: Record<string, unknown>) { return apiRequest<unknown>(`${CF}/form-assignments`, { method: "POST", body: JSON.stringify(data) }); }
export async function cfUpdateFormAssignment(id: string, data: Record<string, unknown>) { return apiRequest<unknown>(`${CF}/form-assignments/${id}`, { method: "PATCH", body: JSON.stringify(data) }); }

export async function cfListTerms(clientId: string) { return apiRequest<unknown[]>(`${CF}/clients/${clientId}/terms`); }
export async function cfCreateTerms(clientId: string, data: Record<string, unknown>) { return apiRequest<{ id: string }>(`${CF}/clients/${clientId}/terms`, { method: "POST", body: JSON.stringify(data) }); }
export async function cfUpdateTerms(id: string, data: Record<string, unknown>) { return apiRequest<unknown>(`${CF}/terms/${id}`, { method: "PATCH", body: JSON.stringify(data) }); }
export async function cfListAllTerms() { return apiRequest<unknown[]>(`${CF}/terms`); }

export async function cfListMonitoring(clientId: string) { return apiRequest<unknown[]>(`${CF}/clients/${clientId}/monitoring`); }
export async function cfCreateMonitoringItem(clientId: string, data: Record<string, unknown>) { return apiRequest<{ id: string }>(`${CF}/clients/${clientId}/monitoring`, { method: "POST", body: JSON.stringify(data) }); }
export async function cfUpdateMonitoringItem(id: string, data: Record<string, unknown>) { return apiRequest<unknown>(`${CF}/monitoring/${id}`, { method: "PATCH", body: JSON.stringify(data) }); }
export async function cfListAllMonitoring() { return apiRequest<unknown[]>(`${CF}/monitoring`); }

export async function cfListContracts(clientId: string) { return apiRequest<unknown[]>(`${CF}/clients/${clientId}/contracts`); }
export async function cfCreateContract(clientId: string, data: Record<string, unknown>) { return apiRequest<{ id: string }>(`${CF}/clients/${clientId}/contracts`, { method: "POST", body: JSON.stringify(data) }); }
export async function cfUpdateContract(id: string, data: Record<string, unknown>) { return apiRequest<unknown>(`${CF}/contracts/${id}`, { method: "PATCH", body: JSON.stringify(data) }); }
export async function cfListAllContracts() { return apiRequest<unknown[]>(`${CF}/contracts`); }

export async function cfListDocuments(clientId: string) { return apiRequest<unknown[]>(`${CF}/clients/${clientId}/documents`); }
export async function cfCreateDocument(clientId: string, data: Record<string, unknown>) { return apiRequest<{ id: string }>(`${CF}/clients/${clientId}/documents`, { method: "POST", body: JSON.stringify(data) }); }
export async function cfListAllDocuments() { return apiRequest<unknown[]>(`${CF}/documents`); }

export async function cfListCommunications(clientId: string) { return apiRequest<unknown[]>(`${CF}/clients/${clientId}/communications`); }
export async function cfCreateCommunication(clientId: string, data: Record<string, unknown>) { return apiRequest<{ id: string }>(`${CF}/clients/${clientId}/communications`, { method: "POST", body: JSON.stringify(data) }); }
export async function cfListAllCommunications() { return apiRequest<unknown[]>(`${CF}/communications`); }

export async function cfListFinalReports(clientId: string) { return apiRequest<unknown[]>(`${CF}/clients/${clientId}/final-reports`); }
export async function cfCreateFinalReport(clientId: string, data: Record<string, unknown>) { return apiRequest<{ id: string }>(`${CF}/clients/${clientId}/final-reports`, { method: "POST", body: JSON.stringify(data) }); }
export async function cfListAllFinalReports() { return apiRequest<unknown[]>(`${CF}/final-reports`); }

export async function cfListActivity(clientId?: string) {
  const qs = clientId ? `?clientId=${encodeURIComponent(clientId)}` : "";
  return apiRequest<unknown[]>(`${CF}/activity${qs}`);
}
export async function cfCreateActivity(data: Record<string, unknown>) { return apiRequest<unknown>(`${CF}/activity`, { method: "POST", body: JSON.stringify(data) }); }

export async function cfSeedDemo(payload: Record<string, unknown[]>) {
  return apiRequest<{ seeded: Record<string, number> }>(`${CF}/seed-demo`, { method: "POST", body: JSON.stringify(payload) });
}
export async function cfRemoveDemo(ids: Record<string, string[]>) {
  return apiRequest<{ removed: boolean }>(`${CF}/remove-demo`, { method: "POST", body: JSON.stringify(ids) });
}
