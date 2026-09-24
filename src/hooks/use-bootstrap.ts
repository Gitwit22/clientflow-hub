import { useEffect } from "react";
import { getState, useAppState, setState } from "@/lib/store";
import * as api from "@/lib/apiClient";

async function loadRequired<T>(
  label: string,
  request: Promise<T>,
  fallback: T,
  onWarning?: (message: string) => void,
): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof api.SessionExpiredError) throw error;
    const message = error instanceof Error ? error.message : "Request failed";
    console.warn(`[Bootstrap] ${label} could not be loaded; using fallback data.`, {
      message,
      error,
    });
    onWarning?.(`${label} could not be loaded: ${message}`);
    return fallback;
  }
}

async function loadOptional<T>(label: string, request: Promise<T>, fallback: T): Promise<T> {
  try {
    return await request;
  } catch (error) {
    if (error instanceof api.SessionExpiredError) throw error;
    console.warn(`[Bootstrap] ${label} could not be loaded; continuing without it.`, error);
    return fallback;
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
    const adminId = authenticatedAdmin.id;

    setState((current) => ({ ...current, bootstrapStatus: "loading", bootstrapError: null }));

    void (async () => {
      try {
        let liveMode = false;
        const bootstrapWarnings: string[] = [];

        try {
          const demoStatus = await api.cfGetDemoStatus();
          liveMode = demoStatus.liveMode;
        } catch (error) {
          const message = error instanceof Error ? error.message : "Demo status unavailable";
          console.warn("[Bootstrap] Demo status could not be loaded; defaulting to liveMode false.", {
            message,
            error,
          });
          bootstrapWarnings.push(`Demo status could not be loaded: ${message}`);
        }

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
          loadRequired("Clients", api.cfListClients(), [], (message) => bootstrapWarnings.push(message)),
          loadRequired("Programs", api.cfListPrograms(), [], (message) => bootstrapWarnings.push(message)),
          loadOptional("Enrollments", api.cfListEnrollments(), []),
          loadRequired("Form templates", api.cfListFormTemplates(), [], (message) => bootstrapWarnings.push(message)),
          loadRequired("Form assignments", api.cfListFormAssignments(), [], (message) => bootstrapWarnings.push(message)),
          loadRequired("Intake submissions", api.cfListIntakeSubmissions(), [], (message) => bootstrapWarnings.push(message)),
          loadRequired("Terms", api.cfListAllTerms(), [], (message) => bootstrapWarnings.push(message)),
          loadRequired("Monitoring", api.cfListAllMonitoring(), [], (message) => bootstrapWarnings.push(message)),
          loadOptional("Contracts", api.cfListAllContracts(), []),
          loadRequired("Documents", api.cfListAllDocuments(), [], (message) => bootstrapWarnings.push(message)),
          loadOptional("Communications", api.cfListAllCommunications(), []),
          loadRequired("Final reports", api.cfListAllFinalReports(), [], (message) => bootstrapWarnings.push(message)),
          loadOptional("Activity", api.cfListActivity(), []),
        ]);

        if (
          getState().authStatus !== "authenticated" ||
          getState().authenticatedAdmin?.id !== adminId
        )
          return;

        setState((prev) => ({
          ...prev,
          liveMode,
          bootstrapStatus: "ready",
          bootstrapError: bootstrapWarnings.length ? bootstrapWarnings.join("; ") : null,
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
        }));
      } catch (error) {
        if (
          getState().authStatus !== "authenticated" ||
          getState().authenticatedAdmin?.id !== adminId
        )
          return;
        const errorMsg =
          error instanceof Error ? error.message : "ClientFlow data could not be loaded.";
        console.error("[Bootstrap] Failed to load required data:", {
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
