import { useEffect, useRef } from "react";
import { useAppState, setState } from "@/lib/store";
import * as api from "@/lib/apiClient";
import * as mock from "@/data/mock";
import { MOCK_IDS } from "@/data/mock";
import type {
  Client,
  Program,
  FormTemplate,
  FormAssignment,
  Terms,
  MonitoringItem,
  Contract,
  ClientDocument,
  Communication,
  FinalReport,
  ActivityLog,
} from "@/types";

/**
 * On mount (after auth), seeds ALL mock data to the backend (if not hidden),
 * then fetches every entity type and merges with mock data.
 * Re-runs when token changes (i.e. once per page-load/login session).
 */
export function useBootstrap() {
  const { accessToken, authenticatedAdmin, mockHidden } = useAppState();
  const ranRef = useRef<string | null>(null);

  useEffect(() => {
    if (!accessToken || !authenticatedAdmin) return;
    if (ranRef.current === accessToken) return;
    ranRef.current = accessToken;

    void (async () => {
      try {
        const organization = authenticatedAdmin.organizationId
          ? await api.getOrganizationSettings(authenticatedAdmin.organizationId)
          : null;
        const liveMode = organization?.liveMode ?? false;

        // ── Step 1: Seed ALL mock data to the backend (upsert — safe to repeat) ──
        if (!liveMode && !mockHidden) {
          await api.cfSeedDemo({
            programs: mock.programs as unknown as Record<string, unknown>[],
            formTemplates: mock.formTemplates as unknown as Record<string, unknown>[],
            clients: mock.clients as unknown as Record<string, unknown>[],
            formAssignments: mock.formAssignments as unknown as Record<string, unknown>[],
            terms: mock.termsList as unknown as Record<string, unknown>[],
            monitoring: mock.monitoringItems as unknown as Record<string, unknown>[],
            contracts: mock.contracts as unknown as Record<string, unknown>[],
            documents: mock.documents as unknown as Record<string, unknown>[],
            communications: mock.communications as unknown as Record<string, unknown>[],
            finalReports: mock.finalReports as unknown as Record<string, unknown>[],
            activity: mock.activityLogs as unknown as Record<string, unknown>[],
          }).catch(() => undefined); // Never block the UI if seeding fails
        }

        // ── Step 2: Fetch all entity types from backend ────────────────────────
        const [
          remoteClients,
          remotePrograms,
          remoteFormTemplates,
          remoteFormAssignments,
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
          api.cfListFormTemplates(),
          api.cfListFormAssignments(),
          api.cfListAllTerms(),
          api.cfListAllMonitoring(),
          api.cfListAllContracts(),
          api.cfListAllDocuments(),
          api.cfListAllCommunications(),
          api.cfListAllFinalReports(),
          api.cfListActivity(),
        ]);

        // ── Step 3: Merge — remote wins on ID collision ────────────────────────
        setState((prev) => {
          const keepMock = !liveMode && !mockHidden;
          const remoteClientIds = new Set((remoteClients as Client[]).map((c) => c.id));
          const remoteProgramIds = new Set((remotePrograms as Program[]).map((p) => p.id));
          const remoteTemplateIds = new Set((remoteFormTemplates as FormTemplate[]).map((t) => t.id));
          const remoteAssignmentIds = new Set((remoteFormAssignments as FormAssignment[]).map((a) => a.id));
          const remoteTermIds = new Set((remoteTerms as Terms[]).map((t) => t.id));
          const remoteMonitoringIds = new Set((remoteMonitoring as MonitoringItem[]).map((m) => m.id));
          const remoteContractIds = new Set((remoteContracts as Contract[]).map((c) => c.id));
          const remoteDocumentIds = new Set((remoteDocuments as ClientDocument[]).map((d) => d.id));
          const remoteCommIds = new Set((remoteCommunications as Communication[]).map((c) => c.id));
          const remoteFinalReportIds = new Set((remoteFinalReports as FinalReport[]).map((f) => f.id));
          const remoteActivityIds = new Set((remoteActivity as ActivityLog[]).map((a) => a.id));

          return {
            ...prev,
            liveMode,
            mockHidden: liveMode || prev.mockHidden,
            clients: [
              ...(remoteClients as Client[]),
              ...(keepMock ? mock.clients.filter((c) => !remoteClientIds.has(c.id)) : []),
            ],
            programs: [
              ...(remotePrograms as Program[]),
              ...(keepMock ? mock.programs.filter((p) => !remoteProgramIds.has(p.id)) : []),
            ],
            formTemplates: [
              ...(remoteFormTemplates as FormTemplate[]),
              ...(keepMock ? mock.formTemplates.filter((t) => !remoteTemplateIds.has(t.id)) : []),
            ],
            formAssignments: [
              ...(remoteFormAssignments as FormAssignment[]),
              ...(keepMock ? mock.formAssignments.filter((a) => !remoteAssignmentIds.has(a.id)) : []),
            ],
            terms: [
              ...(remoteTerms as Terms[]),
              ...(keepMock ? mock.termsList.filter((t) => !remoteTermIds.has(t.id)) : []),
            ],
            monitoring: [
              ...(remoteMonitoring as MonitoringItem[]),
              ...(keepMock ? mock.monitoringItems.filter((m) => !remoteMonitoringIds.has(m.id)) : []),
            ],
            contracts: [
              ...(remoteContracts as Contract[]),
              ...(keepMock ? mock.contracts.filter((c) => !remoteContractIds.has(c.id)) : []),
            ],
            documents: [
              ...(remoteDocuments as ClientDocument[]),
              ...(keepMock ? mock.documents.filter((d) => !remoteDocumentIds.has(d.id)) : []),
            ],
            communications: [
              ...(remoteCommunications as Communication[]),
              ...(keepMock ? mock.communications.filter((c) => !remoteCommIds.has(c.id)) : []),
            ],
            finalReports: [
              ...(remoteFinalReports as FinalReport[]),
              ...(keepMock ? mock.finalReports.filter((f) => !remoteFinalReportIds.has(f.id)) : []),
            ],
            activity: [
              ...(remoteActivity as ActivityLog[]),
              ...(keepMock ? mock.activityLogs.filter((a) => !remoteActivityIds.has(a.id)) : []),
            ],
          };
        });
      } catch {
        // Network/auth errors — keep existing mock data, don't crash
      }
    })();
  }, [accessToken, authenticatedAdmin, mockHidden]);
}
