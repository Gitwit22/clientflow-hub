import { useSyncExternalStore } from "react";
import * as mock from "@/data/mock";
import { MOCK_IDS } from "@/data/mock";
import type {
  ActivityLog,
  Client,
  ClientDocument,
  Communication,
  Contract,
  FinalReport,
  FormAssignment,
  FormTemplate,
  IntakeSubmission,
  EnrollmentMonitoring,
  Program,
  ProgramEnrollment,
  Terms,
} from "@/types";

export interface AppState {
  accessToken: string | null;
  authenticatedAdmin: AuthenticatedAdmin | null;
  clients: Client[];
  programs: Program[];
  enrollments: ProgramEnrollment[];
  formTemplates: FormTemplate[];
  formAssignments: FormAssignment[];
  intakeSubmissions: IntakeSubmission[];
  terms: Terms[];
  monitoring: EnrollmentMonitoring[];
  contracts: Contract[];
  documents: ClientDocument[];
  communications: Communication[];
  finalReports: FinalReport[];
  activity: ActivityLog[];
  liveMode: boolean;
  /** Whether mock data is hidden for this session */
  mockHidden: boolean;
}

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  organizationId?: string;
}

// ─── localStorage helpers ────────────────────────────────────────────────────
const TOKEN_KEY = "cf:token";
const ADMIN_KEY = "cf:admin";
const SESSION_DEMO_HIDDEN_KEY = "cf:demoHiddenForLogin";

function loadFromStorage(): Pick<AppState, "accessToken" | "authenticatedAdmin"> {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    const admin = localStorage.getItem(ADMIN_KEY);
    return {
      accessToken: token ?? null,
      authenticatedAdmin: admin ? (JSON.parse(admin) as AuthenticatedAdmin) : null,
    };
  } catch {
    return { accessToken: null, authenticatedAdmin: null };
  }
}

function isMockHiddenForOrg(orgId: string): boolean {
  try {
    return localStorage.getItem(SESSION_DEMO_HIDDEN_KEY) === orgId;
  } catch {
    return false;
  }
}

const persisted = loadFromStorage();

let state: AppState = {
  ...persisted,
  clients: mock.clients,
  programs: mock.programs,
  enrollments: mock.enrollments,
  formTemplates: mock.formTemplates,
  formAssignments: mock.formAssignments,
  intakeSubmissions: [],
  terms: mock.termsList,
  monitoring: mock.monitoring,
  contracts: mock.contracts,
  documents: mock.documents,
  communications: mock.communications,
  finalReports: mock.finalReports,
  activity: mock.activityLogs,
  liveMode: false,
  mockHidden: persisted.authenticatedAdmin?.organizationId
    ? isMockHiddenForOrg(persisted.authenticatedAdmin.organizationId)
    : false,
};

const serverState: AppState = {
  ...state,
  accessToken: null,
  authenticatedAdmin: null,
  mockHidden: false,
};

const listeners = new Set<() => void>();

export const getState = () => state;

export function setState(updater: (prev: AppState) => AppState) {
  state = updater(state);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useAppState(): AppState {
  return useSyncExternalStore(subscribe, getState, () => serverState);
}

export function setAuthSession(accessToken: string, authenticatedAdmin: AuthenticatedAdmin) {
  const accountChanged =
    state.accessToken !== accessToken ||
    state.authenticatedAdmin?.organizationId !== authenticatedAdmin.organizationId;
  try {
    if (localStorage.getItem(TOKEN_KEY) !== accessToken) {
      localStorage.removeItem(SESSION_DEMO_HIDDEN_KEY);
    }
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(ADMIN_KEY, JSON.stringify(authenticatedAdmin));
  } catch {
    /* storage unavailable */
  }
  const orgId = authenticatedAdmin.organizationId;
  const mockHidden = orgId ? isMockHiddenForOrg(orgId) : false;
  setState((current) => ({
    ...current,
    accessToken,
    authenticatedAdmin,
    liveMode: accountChanged ? false : current.liveMode,
    mockHidden,
    clients: accountChanged ? [] : current.clients,
    programs: accountChanged ? [] : current.programs,
    enrollments: accountChanged ? [] : current.enrollments,
    formTemplates: accountChanged ? [] : current.formTemplates,
    formAssignments: accountChanged ? [] : current.formAssignments,
    intakeSubmissions: accountChanged ? [] : current.intakeSubmissions,
    terms: accountChanged ? [] : current.terms,
    monitoring: accountChanged ? [] : current.monitoring,
    contracts: accountChanged ? [] : current.contracts,
    documents: accountChanged ? [] : current.documents,
    communications: accountChanged ? [] : current.communications,
    finalReports: accountChanged ? [] : current.finalReports,
    activity: accountChanged ? [] : current.activity,
  }));
}

export function clearAccessToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADMIN_KEY);
    localStorage.removeItem(SESSION_DEMO_HIDDEN_KEY);
  } catch {
    /* storage unavailable */
  }
  setState((current) => ({
    ...current,
    accessToken: null,
    authenticatedAdmin: null,
    liveMode: false,
    mockHidden: false,
    clients: [],
    programs: [],
    enrollments: [],
    formTemplates: [],
    formAssignments: [],
    intakeSubmissions: [],
    terms: [],
    monitoring: [],
    contracts: [],
    documents: [],
    communications: [],
    finalReports: [],
    activity: [],
  }));
}

const isDemoRecord = (record: { id: string; isDemo?: boolean }, ids: Set<string>) =>
  record.isDemo === true || ids.has(record.id);

export function hideMockData(permanent: boolean) {
  const orgId = state.authenticatedAdmin?.organizationId;
  if (!permanent && orgId) {
    try {
      localStorage.setItem(SESSION_DEMO_HIDDEN_KEY, orgId);
    } catch {
      /* noop */
    }
  }
  setState((current) => ({
    ...current,
    liveMode: permanent ? true : current.liveMode,
    mockHidden: true,
    clients: current.clients.filter((c) => !isDemoRecord(c, MOCK_IDS.clients)),
    enrollments: current.enrollments.filter(
      (enrollment) => !isDemoRecord(enrollment, MOCK_IDS.enrollments),
    ),
    // programs and formTemplates are intentionally kept
    formAssignments: current.formAssignments.filter(
      (a) => !isDemoRecord(a, MOCK_IDS.formAssignments),
    ),
    intakeSubmissions: current.intakeSubmissions.filter((submission) => !submission.isDemo),
    terms: current.terms.filter((t) => !isDemoRecord(t, MOCK_IDS.terms)),
    monitoring: current.monitoring.filter((m) => !isDemoRecord(m, MOCK_IDS.monitoring)),
    contracts: current.contracts.filter((c) => !isDemoRecord(c, MOCK_IDS.contracts)),
    documents: current.documents.filter((d) => !isDemoRecord(d, MOCK_IDS.documents)),
    communications: current.communications.filter((c) => !isDemoRecord(c, MOCK_IDS.communications)),
    finalReports: current.finalReports.filter((f) => !isDemoRecord(f, MOCK_IDS.finalReports)),
    activity: current.activity.filter((a) => !isDemoRecord(a, MOCK_IDS.activity)),
  }));
}

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
