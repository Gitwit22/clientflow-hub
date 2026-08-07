/**
 * API HTTP client — cookie-based sessions, no localStorage.
 *
 * All requests include `credentials: "include"` so the browser automatically
 * sends the __Host-clientflow_access and __Host-clientflow_refresh HttpOnly
 * cookies that the backend sets on login.
 *
 * No token is ever stored in JavaScript — no localStorage, no sessionStorage.
 */

const API_URL = (import.meta.env.VITE_API_URL as string | undefined) ?? '';

// ─── Error types ─────────────────────────────────────────────────────────────

export class SessionExpiredError extends Error {
  constructor() {
    super('Session expired. Please log in again.');
    this.name = 'SessionExpiredError';
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function parseApiError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as Record<string, unknown>;
    const message = (body['message'] as string | undefined) ?? response.statusText;
    const code = (body['error'] as string | undefined) ?? 'UNKNOWN';
    return new ApiError(response.status, code, message);
  } catch {
    return new ApiError(response.status, 'PARSE_ERROR', response.statusText);
  }
}

// ─── Core request helper ─────────────────────────────────────────────────────

export async function apiRequest<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    credentials: 'include', // required: sends HttpOnly cookies cross-origin
    headers: {
      'Content-Type': 'application/json',
      ...init.headers,
    },
  });

  if (response.status === 401) {
    throw new SessionExpiredError();
  }

  if (!response.ok) {
    throw await parseApiError(response);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
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

/** POST /auth/login — sets HttpOnly cookies; returns admin info only (no token). */
export async function login(payload: LoginPayload): Promise<{ admin: AdminInfo }> {
  return apiRequest('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** POST /auth/logout — revokes session, clears cookies server-side. */
export async function logout(): Promise<void> {
  return apiRequest('/api/v1/auth/logout', { method: 'POST' });
}

/**
 * POST /auth/refresh — rotates refresh token and issues new access cookie.
 * The browser sends the refresh cookie automatically; no token in JS.
 */
export async function refreshSession(): Promise<{ ok: boolean }> {
  return apiRequest('/api/v1/auth/refresh', { method: 'POST' });
}

/**
 * GET /auth/bootstrap — primary startup call.
 * Returns user context, active organization, settings, and resolved permissions.
 * Never pass org/permissions from frontend state — server resolves everything.
 */
export async function bootstrap(): Promise<BootstrapData> {
  return apiRequest('/api/v1/auth/bootstrap');
}

/** GET /auth/session — lightweight liveness check. Returns 401 if expired. */
export async function getSession(): Promise<{ valid: boolean }> {
  return apiRequest('/api/v1/auth/session');
}

export interface ChangePasswordPayload {
  currentPassword: string;
  newPassword: string;
}

/** POST /auth/change-password — revokes all sessions; user must log in again. */
export async function changePassword(payload: ChangePasswordPayload): Promise<{ message: string }> {
  return apiRequest('/api/v1/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

/** POST /auth/forgot-password */
export async function forgotPassword(email: string): Promise<{ message: string }> {
  return apiRequest('/api/v1/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

// ─── Organization endpoints ───────────────────────────────────────────────────

export async function getOrganizationSettings(organizationId: string) {
  return apiRequest(`/api/v1/organizations/${organizationId}/settings`);
}

export async function listMembers(organizationId: string) {
  return apiRequest(`/api/v1/organizations/${organizationId}/members`);
}

export async function getMember(organizationId: string, memberId: string) {
  return apiRequest(`/api/v1/organizations/${organizationId}/members/${memberId}`);
}

export interface InviteMemberPayload {
  email: string;
  firstName: string;
  lastName?: string;
  role?: 'org_admin' | 'reviewer';
}

export async function inviteMember(organizationId: string, payload: InviteMemberPayload) {
  return apiRequest(`/api/v1/organizations/${organizationId}/invitations`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export async function updateMemberRole(
  organizationId: string,
  memberId: string,
  role: 'org_admin' | 'reviewer',
) {
  return apiRequest(`/api/v1/organizations/${organizationId}/members/${memberId}/role`, {
    method: 'PATCH',
    body: JSON.stringify({ role }),
  });
}

export async function disableMember(organizationId: string, memberId: string) {
  return apiRequest(`/api/v1/organizations/${organizationId}/members/${memberId}/disable`, {
    method: 'POST',
  });
}

export async function enableMember(organizationId: string, memberId: string) {
  return apiRequest(`/api/v1/organizations/${organizationId}/members/${memberId}/enable`, {
    method: 'POST',
  });
}
