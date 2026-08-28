import { useEffect, useRef } from "react";
import { useAppState, setState } from "@/lib/store";
import * as api from "@/lib/apiClient";
import * as mock from "@/data/mock";
import { MOCK_IDS } from "@/data/mock";
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
 * On mount (after auth), seeds program/form configuration to the backend,
 * then fetches every entity type and merges operational mock data locally.
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
        const demoStatus = await api.cfGetDemoStatus();
        const liveMode = demoStatus.liveMode;

        // ── Step 1: Persist reusable configuration only (upsert — safe to repeat) ──
        await api
          .cfSeedDemo({
            programs: mock.programs as unknown as Record<string, unknown>[],
            formTemplates: mock.formTemplates as unknown as Record<string, unknown>[],
          })
          .catch(() => undefined); // Never block the UI if seeding fails

        // ── Step 2: Fetch all entity types from backend ────────────────────────
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

        // ── Step 3: Merge — remote wins on ID collision ────────────────────────
        setState((prev) => {
          const keepMock = !liveMode && !mockHidden;
          const hideDemo = liveMode || mockHidden;
          const visible = <T extends { isDemo?: boolean }>(records: T[]) =>
            hideDemo ? records.filter((record) => !record.isDemo) : records;
          const remoteClientIds = new Set((remoteClients as Client[]).map((c) => c.id));
          const remoteProgramIds = new Set((remotePrograms as Program[]).map((p) => p.id));
          const remoteTemplateIds = new Set(
            (remoteFormTemplates as FormTemplate[]).map((t) => t.id),
          );
          const remoteAssignmentIds = new Set(
            (remoteFormAssignments as FormAssignment[]).map((a) => a.id),
          );
          const remoteTermIds = new Set((remoteTerms as Terms[]).map((t) => t.id));
          const remoteContractIds = new Set((remoteContracts as Contract[]).map((c) => c.id));
          const remoteDocumentIds = new Set((remoteDocuments as ClientDocument[]).map((d) => d.id));
          const remoteCommIds = new Set((remoteCommunications as Communication[]).map((c) => c.id));
          const remoteFinalReportIds = new Set(
            (remoteFinalReports as FinalReport[]).map((f) => f.id),
          );
          const remoteActivityIds = new Set((remoteActivity as ActivityLog[]).map((a) => a.id));

          return {
            ...prev,
            liveMode,
            mockHidden: liveMode || prev.mockHidden,
            clients: [
              ...visible(remoteClients as Client[]),
              ...(keepMock ? mock.clients.filter((c) => !remoteClientIds.has(c.id)) : []),
            ],
            programs: [
              ...(remotePrograms as Program[]),
              ...(keepMock ? mock.programs.filter((p) => !remoteProgramIds.has(p.id)) : []),
            ],
            enrollments: visible(remoteEnrollments as ProgramEnrollment[]),
            formTemplates: [
              ...(remoteFormTemplates as FormTemplate[]),
              ...(keepMock ? mock.formTemplates.filter((t) => !remoteTemplateIds.has(t.id)) : []),
            ],
            formAssignments: [
              ...visible(remoteFormAssignments as FormAssignment[]),
              ...(keepMock
                ? mock.formAssignments.filter((a) => !remoteAssignmentIds.has(a.id))
                : []),
            ],
            intakeSubmissions: visible(remoteIntakeSubmissions as IntakeSubmission[]),
            terms: [
              ...visible(remoteTerms as Terms[]),
              ...(keepMock ? mock.termsList.filter((t) => !remoteTermIds.has(t.id)) : []),
            ],
            monitoring: visible(remoteMonitoring as EnrollmentMonitoring[]),
            contracts: [
              ...visible(remoteContracts as Contract[]),
              ...(keepMock ? mock.contracts.filter((c) => !remoteContractIds.has(c.id)) : []),
            ],
            documents: [
              ...visible(remoteDocuments as ClientDocument[]),
              ...(keepMock ? mock.documents.filter((d) => !remoteDocumentIds.has(d.id)) : []),
            ],
            communications: [
              ...visible(remoteCommunications as Communication[]),
              ...(keepMock ? mock.communications.filter((c) => !remoteCommIds.has(c.id)) : []),
            ],
            finalReports: [
              ...visible(remoteFinalReports as FinalReport[]),
              ...(keepMock ? mock.finalReports.filter((f) => !remoteFinalReportIds.has(f.id)) : []),
            ],
            activity: [
              ...visible(remoteActivity as ActivityLog[]),
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
