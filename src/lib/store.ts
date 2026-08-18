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
  MonitoringItem,
  Program,
  Terms,
} from "@/types";

export interface AppState {
  accessToken: string | null;
  authenticatedAdmin: AuthenticatedAdmin | null;
  clients: Client[];
  programs: Program[];
  formTemplates: FormTemplate[];
  formAssignments: FormAssignment[];
  terms: Terms[];
  monitoring: MonitoringItem[];
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
const TOKEN_KEY = 'cf:token';
const ADMIN_KEY = 'cf:admin';

function loadFromStorage(): Pick<AppState, 'accessToken' | 'authenticatedAdmin'> {
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
    return localStorage.getItem(`cf:mockRemoved:${orgId}`) === '1';
  } catch {
    return false;
  }
}

const persisted = loadFromStorage();

let state: AppState = {
  ...persisted,
  clients: mock.clients,
  programs: mock.programs,
  formTemplates: mock.formTemplates,
  formAssignments: mock.formAssignments,
  terms: mock.termsList,
  monitoring: mock.monitoringItems,
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
  return useSyncExternalStore(subscribe, getState, getState);
}

export function setAuthSession(accessToken: string, authenticatedAdmin: AuthenticatedAdmin) {
  try {
    localStorage.setItem(TOKEN_KEY, accessToken);
    localStorage.setItem(ADMIN_KEY, JSON.stringify(authenticatedAdmin));
  } catch { /* storage unavailable */ }
  const orgId = authenticatedAdmin.organizationId;
  const mockHidden = orgId ? isMockHiddenForOrg(orgId) : false;
  setState((current) => ({ ...current, accessToken, authenticatedAdmin, mockHidden }));
}

export function clearAccessToken() {
  try {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(ADMIN_KEY);
  } catch { /* storage unavailable */ }
  setState((current) => ({ ...current, accessToken: null, authenticatedAdmin: null, liveMode: false, mockHidden: false }));
}

/**
 * Hide mock data for this session (permanent=false) or permanently per org (permanent=true).
 * When hidden, filters all mock IDs out of the in-memory state.
 */
export function hideMockData(permanent: boolean) {
  const orgId = state.authenticatedAdmin?.organizationId;
  if (permanent && orgId) {
    try { localStorage.setItem(`cf:mockRemoved:${orgId}`, '1'); } catch { /* noop */ }
  }
  setState((current) => ({
    ...current,
    liveMode: permanent ? true : current.liveMode,
    mockHidden: true,
    clients: current.clients.filter((c) => !MOCK_IDS.clients.has(c.id)),
    // programs and formTemplates are intentionally kept
    formAssignments: current.formAssignments.filter((a) => !MOCK_IDS.formAssignments.has(a.id)),
    terms: current.terms.filter((t) => !MOCK_IDS.terms.has(t.id)),
    monitoring: current.monitoring.filter((m) => !MOCK_IDS.monitoring.has(m.id)),
    contracts: current.contracts.filter((c) => !MOCK_IDS.contracts.has(c.id)),
    documents: current.documents.filter((d) => !MOCK_IDS.documents.has(d.id)),
    communications: current.communications.filter((c) => !MOCK_IDS.communications.has(c.id)),
    finalReports: current.finalReports.filter((f) => !MOCK_IDS.finalReports.has(f.id)),
    activity: current.activity.filter((a) => !MOCK_IDS.activity.has(a.id)),
  }));
}

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
