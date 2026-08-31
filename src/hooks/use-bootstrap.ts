import { useEffect } from "react";
import { useAppState, setState } from "@/lib/store";
import * as api from "@/lib/apiClient";
import type {
  Client,
  Program,
  ProgramEnrollment,
  FormTemplate,
  FormAssignment,
  IntakeSubmission,
  Terms,
  EnrollmentMonitoring,
  Contract,
  ClientDocument,
  Communication,
  FinalReport,
  ActivityLog,
} from "@/types";

/**
 * Loads the complete persisted organization snapshot after authentication.
 */
export function useBootstrap() {
  const { authStatus, authenticatedAdmin, bootstrapStatus } = useAppState();

  useEffect(() => {
    if (authStatus !== "authenticated" || !authenticatedAdmin) return;
    if (bootstrapStatus !== "idle") return;

    setState((current) => ({ ...current, bootstrapStatus: "loading", bootstrapError: null }));

    void (async () => {
      try {
        const demoStatus = await api.cfGetDemoStatus();
        const liveMode = demoStatus.liveMode;

        // Parallelize all data fetches using Promise.all() to reduce load time
        // Each call has individual error handling to identify which one fails
        const [
          remoteClients,
          remotePrograms,
          remoteEnrollments,
          remoteFormTemplates,
          remoteFormAssignments,
          remoteIntakeSubmissions,
          remoteTerms,
          remoteMonitoring,
          remoteContracts,
          remoteDocuments,
          remoteCommunications,
          remoteFinalReports,
          remoteActivity,
        ] = await Promise.all([
          api.cfListClients().catch((e) => {
            console.error("[Bootstrap] cfListClients failed:", e);
            return [];
          }),
          api.cfListPrograms().catch((e) => {
            console.error("[Bootstrap] cfListPrograms failed:", e);
            return [];
          }),
          api.cfListEnrollments().catch((e) => {
            console.error("[Bootstrap] cfListEnrollments failed:", e);
            return [];
          }),
          api.cfListFormTemplates().catch((e) => {
            console.error("[Bootstrap] cfListFormTemplates failed:", e);
            return [];
          }),
          api.cfListFormAssignments().catch((e) => {
            console.error("[Bootstrap] cfListFormAssignments failed:", e);
            return [];
          }),
          api.cfListIntakeSubmissions().catch((e) => {
            console.error("[Bootstrap] cfListIntakeSubmissions failed:", e);
            return [];
          }),
          api.cfListAllTerms().catch((e) => {
            console.error("[Bootstrap] cfListAllTerms failed:", e);
            return [];
          }),
          api.cfListAllMonitoring().catch((e) => {
            console.error("[Bootstrap] cfListAllMonitoring failed:", e);
            return [];
          }),
          api.cfListAllContracts().catch((e) => {
            console.error("[Bootstrap] cfListAllContracts failed:", e);
            return [];
          }),
          api.cfListAllDocuments().catch((e) => {
            console.error("[Bootstrap] cfListAllDocuments failed:", e);
            return [];
          }),
          api.cfListAllCommunications().catch((e) => {
            console.error("[Bootstrap] cfListAllCommunications failed:", e);
            return [];
          }),
          api.cfListAllFinalReports().catch((e) => {
            console.error("[Bootstrap] cfListAllFinalReports failed:", e);
            return [];
          }),
          api.cfListActivity().catch((e) => {
            console.error("[Bootstrap] cfListActivity failed:", e);
            return [];
          }),
        ]);

        const results = {
          remoteClients,
          remotePrograms,
          remoteEnrollments,
          remoteFormTemplates,
          remoteFormAssignments,
          remoteIntakeSubmissions,
          remoteTerms,
          remoteMonitoring,
          remoteContracts,
          remoteDocuments,
          remoteCommunications,
          remoteFinalReports,
          remoteActivity,
        };

        setState((prev) => {
          return {
            ...prev,
            liveMode,
            bootstrapStatus: "ready",
            bootstrapError: null,
            clients: results.remoteClients as Client[],
            programs: results.remotePrograms as Program[],
            enrollments: results.remoteEnrollments as ProgramEnrollment[],
            formTemplates: results.remoteFormTemplates as FormTemplate[],
            formAssignments: results.remoteFormAssignments as FormAssignment[],
            intakeSubmissions: results.remoteIntakeSubmissions as IntakeSubmission[],
            terms: results.remoteTerms as Terms[],
            monitoring: results.remoteMonitoring as EnrollmentMonitoring[],
            contracts: results.remoteContracts as Contract[],
            documents: results.remoteDocuments as ClientDocument[],
            communications: results.remoteCommunications as Communication[],
            finalReports: results.remoteFinalReports as FinalReport[],
            activity: results.remoteActivity as ActivityLog[],
          };
        });
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "ClientFlow data could not be loaded.";
        console.error("[Bootstrap] Failed to load data:", {
          error,
          errorMsg,
          stack: error instanceof Error ? error.stack : undefined,
        });
        setState((current) => ({
          ...current,
          bootstrapStatus: "error",
          bootstrapError: errorMsg,
        }));
      }
    })();
  }, [authStatus, authenticatedAdmin, bootstrapStatus]);
}
