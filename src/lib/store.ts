import { useSyncExternalStore } from "react";
import * as mock from "@/data/mock";
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
}

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  role?: string;
  organizationId?: string;
}

let state: AppState = {
  accessToken: null,
  authenticatedAdmin: null,
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
  setState((current) => ({ ...current, accessToken, authenticatedAdmin }));
}

export function clearAccessToken() {
  setState((current) => ({ ...current, accessToken: null, authenticatedAdmin: null }));
}

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
