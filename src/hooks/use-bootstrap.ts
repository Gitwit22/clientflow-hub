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
          api.cfListClients(),
          api.cfListPrograms(),
          api.cfListEnrollments(),
          api.cfListFormTemplates(),
          api.cfListFormAssignments(),
          api.cfListIntakeSubmissions(),
          api.cfListAllTerms(),
          api.cfListAllMonitoring(),
          api.cfListAllContracts(),
          api.cfListAllDocuments(),
          api.cfListAllCommunications(),
          api.cfListAllFinalReports(),
          api.cfListActivity(),
        ]);

        setState((prev) => {
          return {
            ...prev,
            liveMode,
            bootstrapStatus: "ready",
            bootstrapError: null,
            clients: remoteClients as Client[],
            programs: remotePrograms as Program[],
            enrollments: remoteEnrollments as ProgramEnrollment[],
            formTemplates: remoteFormTemplates as FormTemplate[],
            formAssignments: remoteFormAssignments as FormAssignment[],
            intakeSubmissions: remoteIntakeSubmissions as IntakeSubmission[],
            terms: remoteTerms as Terms[],
            monitoring: remoteMonitoring as EnrollmentMonitoring[],
            contracts: remoteContracts as Contract[],
            documents: remoteDocuments as ClientDocument[],
            communications: remoteCommunications as Communication[],
            finalReports: remoteFinalReports as FinalReport[],
            activity: remoteActivity as ActivityLog[],
          };
        });
      } catch (error) {
        setState((current) => ({
          ...current,
          bootstrapStatus: "error",
          bootstrapError:
            error instanceof Error ? error.message : "ClientFlow data could not be loaded.",
        }));
      }
    })();
  }, [authStatus, authenticatedAdmin, bootstrapStatus]);
}
