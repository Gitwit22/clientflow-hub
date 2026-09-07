import { useEffect } from "react";
import { useAppState, setState } from "@/lib/store";
import * as api from "@/lib/apiClient";

async function loadRequired<T>(label: string, request: Promise<T>): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof api.SessionExpiredError) throw error;
    const message = error instanceof Error ? error.message : "Request failed";
    throw new Error(`${label} could not be loaded: ${message}`, { cause: error });
  }
}

/**
 * Loads the complete persisted organization snapshot after authentication.
 */
export function useBootstrap() {
  const { authStatus, authenticatedAdmin, bootstrapStatus } = useAppState();

  useEffect(() => {
    if (authStatus !== "authenticated" || !authenticatedAdmin) return;
    if (bootstrapStatus !== "idle") return;

    let cancelled = false;

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
          loadRequired("Clients", api.cfListClients()),
          loadRequired("Programs", api.cfListPrograms()),
          loadRequired("Enrollments", api.cfListEnrollments()),
          loadRequired("Form templates", api.cfListFormTemplates()),
          loadRequired("Form assignments", api.cfListFormAssignments()),
          loadRequired("Intake submissions", api.cfListIntakeSubmissions()),
          loadRequired("Terms", api.cfListAllTerms()),
          loadRequired("Monitoring", api.cfListAllMonitoring()),
          loadRequired("Contracts", api.cfListAllContracts()),
          loadRequired("Documents", api.cfListAllDocuments()),
          loadRequired("Communications", api.cfListAllCommunications()),
          loadRequired("Final reports", api.cfListAllFinalReports()),
          loadRequired("Activity", api.cfListActivity()),
        ]);

        if (cancelled) return;

        setState((prev) => {
          return {
            ...prev,
            liveMode,
            bootstrapStatus: "ready",
            bootstrapError: null,
            clients: remoteClients,
            programs: remotePrograms,
            enrollments: remoteEnrollments,
            formTemplates: remoteFormTemplates,
            formAssignments: remoteFormAssignments,
            intakeSubmissions: remoteIntakeSubmissions,
            terms: remoteTerms,
            monitoring: remoteMonitoring,
            contracts: remoteContracts,
            documents: remoteDocuments,
            communications: remoteCommunications,
            finalReports: remoteFinalReports,
            activity: remoteActivity,
          };
        });
      } catch (error) {
        if (cancelled) return;
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

    return () => {
      cancelled = true;
    };
  }, [authStatus, authenticatedAdmin, bootstrapStatus]);
}
