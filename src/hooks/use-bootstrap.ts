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
 * On mount (after auth), fetches all CF data from the backend and merges with
 * mock data (unless mock is hidden for this org). Re-runs when token changes.
 */
export function useBootstrap() {
  const { accessToken, authenticatedAdmin, mockHidden } = useAppState();
  const ranRef = useRef<string | null>(null);

  useEffect(() => {
    if (!accessToken || !authenticatedAdmin) return;
    // Only fetch once per token
    if (ranRef.current === accessToken) return;
    ranRef.current = accessToken;

    void (async () => {
      try {
        const [
          remoteClients,
          remotePrograms,
          remoteFormTemplates,
          remoteFormAssignments,
          remoteActivity,
        ] = await Promise.all([
          api.cfListClients(),
          api.cfListPrograms(),
          api.cfListFormTemplates(),
          api.cfListFormAssignments(),
          api.cfListActivity(),
        ]);

        // Seed any mock programs/templates that don't yet exist in the backend.
        // Preserves the original mock IDs so existing form assignments stay valid.
        {
          const remoteProgramIdSet = new Set((remotePrograms as Program[]).map((p) => p.id));
          const remoteTemplateIdSet = new Set((remoteFormTemplates as FormTemplate[]).map((t) => t.id));
          const missingPrograms = mockHidden ? [] : mock.programs.filter((p) => !remoteProgramIdSet.has(p.id));
          const missingTemplates = mockHidden ? [] : mock.formTemplates.filter((t) => !remoteTemplateIdSet.has(t.id));
          if (missingPrograms.length || missingTemplates.length) {
            await Promise.allSettled([
              ...missingPrograms.map((p) => api.cfCreateProgram(p as unknown as Record<string, unknown>)),
              ...missingTemplates.map((t) => api.cfCreateFormTemplate(t as unknown as Record<string, unknown>)),
            ]);
          }
        }

        setState((prev) => {
          const mockClients = mockHidden ? [] : mock.clients.filter((c) => !MOCK_IDS.clients.has(c.id) || true);
          const mockPrograms = mockHidden ? [] : mock.programs;
          const mockTemplates = mockHidden ? [] : mock.formTemplates;
          const mockAssignments = mockHidden ? [] : mock.formAssignments;
          const mockActivity = mockHidden ? [] : mock.activityLogs;

          // Build merged sets (remote wins on ID collision)
          const remoteClientIds = new Set((remoteClients as Client[]).map((c) => c.id));
          const remoteProgramIds = new Set((remotePrograms as Program[]).map((p) => p.id));
          const remoteTemplateIds = new Set((remoteFormTemplates as FormTemplate[]).map((t) => t.id));
          const remoteAssignmentIds = new Set((remoteFormAssignments as FormAssignment[]).map((a) => a.id));
          const remoteActivityIds = new Set((remoteActivity as ActivityLog[]).map((a) => a.id));

          return {
            ...prev,
            clients: [
              ...(remoteClients as Client[]),
              ...mockClients.filter((c) => !remoteClientIds.has(c.id)),
            ],
            programs: [
              ...(remotePrograms as Program[]),
              ...mockPrograms.filter((p) => !remoteProgramIds.has(p.id)),
            ],
            formTemplates: [
              ...(remoteFormTemplates as FormTemplate[]),
              ...mockTemplates.filter((t) => !remoteTemplateIds.has(t.id)),
            ],
            formAssignments: [
              ...(remoteFormAssignments as FormAssignment[]),
              ...mockAssignments.filter((a) => !remoteAssignmentIds.has(a.id)),
            ],
            activity: [
              ...(remoteActivity as ActivityLog[]),
              ...mockActivity.filter((a) => !remoteActivityIds.has(a.id)),
            ],
          };
        });
      } catch {
        // Network/auth errors — keep existing mock data, don't crash
      }
    })();
  }, [accessToken, authenticatedAdmin, mockHidden]);
}
