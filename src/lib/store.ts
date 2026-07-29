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

let state: AppState = {
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

export const uid = (prefix: string) =>
  `${prefix}-${Math.random().toString(36).slice(2, 8)}`;