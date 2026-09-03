import { useSyncExternalStore } from "react";
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
  authStatus: "checking" | "authenticated" | "anonymous";
  bootstrapStatus: "idle" | "loading" | "ready" | "error";
  bootstrapError: string | null;
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
}

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
  jobTitle?: string;
  role?: string;
  organizationId?: string;
}

let state: AppState = {
  authStatus: "checking",
  bootstrapStatus: "idle",
  bootstrapError: null,
  authenticatedAdmin: null,
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
  liveMode: false,
};

const serverState: AppState = {
  ...state,
  authStatus: "checking",
  bootstrapStatus: "idle",
  bootstrapError: null,
  authenticatedAdmin: null,
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

export function setAuthSession(authenticatedAdmin: AuthenticatedAdmin) {
  const accountChanged =
    state.authenticatedAdmin?.organizationId !== authenticatedAdmin.organizationId;
  setState((current) => ({
    ...current,
    authStatus: "authenticated",
    bootstrapStatus: accountChanged ? "idle" : current.bootstrapStatus,
    bootstrapError: accountChanged ? null : current.bootstrapError,
    authenticatedAdmin,
    liveMode: accountChanged ? false : current.liveMode,
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

export function clearAuthSession() {
  setState((current) => ({
    ...current,
    authStatus: "anonymous",
    bootstrapStatus: "idle",
    bootstrapError: null,
    authenticatedAdmin: null,
    liveMode: false,
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

  export function retryBootstrap() {
    setState((current) => ({ ...current, bootstrapStatus: "idle", bootstrapError: null }));
  }

export const uid = (prefix: string) => `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
