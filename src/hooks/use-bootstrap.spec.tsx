import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getState, setState } from "@/lib/store";
import { useBootstrap } from "./use-bootstrap";

vi.mock("@/lib/apiClient", () => ({
  SessionExpiredError: class SessionExpiredError extends Error {},
  cfGetDemoStatus: vi.fn(),
  cfListClients: vi.fn(),
  cfListPrograms: vi.fn(),
  cfListEnrollments: vi.fn(),
  cfListFormTemplates: vi.fn(),
  cfListFormAssignments: vi.fn(),
  cfListIntakeSubmissions: vi.fn(),
  cfListAllTerms: vi.fn(),
  cfListAllMonitoring: vi.fn(),
  cfListAllContracts: vi.fn(),
  cfListAllDocuments: vi.fn(),
  cfListAllCommunications: vi.fn(),
  cfListAllFinalReports: vi.fn(),
  cfListActivity: vi.fn(),
}));

import * as api from "@/lib/apiClient";

describe("useBootstrap", () => {
  beforeEach(() => {
    setState((current) => ({
      ...current,
      authStatus: "authenticated",
      authenticatedAdmin: { id: "admin-1", email: "admin@example.com" },
      bootstrapStatus: "idle",
      bootstrapError: null,
      clients: [],
      programs: [],
    }));

    vi.mocked(api.cfGetDemoStatus).mockResolvedValue({ liveMode: true });
    vi.mocked(api.cfListClients).mockResolvedValue([]);
    vi.mocked(api.cfListPrograms).mockResolvedValue([]);
    vi.mocked(api.cfListEnrollments).mockResolvedValue([]);
    vi.mocked(api.cfListFormTemplates).mockResolvedValue([]);
    vi.mocked(api.cfListFormAssignments).mockResolvedValue([]);
    vi.mocked(api.cfListIntakeSubmissions).mockResolvedValue([]);
    vi.mocked(api.cfListAllTerms).mockResolvedValue([]);
    vi.mocked(api.cfListAllMonitoring).mockResolvedValue([]);
    vi.mocked(api.cfListAllContracts).mockResolvedValue([]);
    vi.mocked(api.cfListAllDocuments).mockResolvedValue([]);
    vi.mocked(api.cfListAllCommunications).mockResolvedValue([]);
    vi.mocked(api.cfListAllFinalReports).mockResolvedValue([]);
    vi.mocked(api.cfListActivity).mockResolvedValue([]);
  });

  it("marks bootstrap ready only after every required collection loads", async () => {
    vi.mocked(api.cfListClients).mockResolvedValue([
      { id: "client-1", businessName: "Example" } as never,
    ]);

    const { unmount } = renderHook(() => useBootstrap());

    await waitFor(() => expect(getState().bootstrapStatus).toBe("ready"));
    expect(getState().clients).toHaveLength(1);
    unmount();
  });

  it("shows a retryable error instead of replacing a failed collection with empty data", async () => {
    vi.mocked(api.cfListPrograms).mockRejectedValue(new Error("Service unavailable"));

    const { unmount } = renderHook(() => useBootstrap());

    await waitFor(() => expect(getState().bootstrapStatus).toBe("error"));
    expect(getState().bootstrapError).toBe("Programs could not be loaded: Service unavailable");
    expect(getState().clients).toEqual([]);
    unmount();
  });
});
