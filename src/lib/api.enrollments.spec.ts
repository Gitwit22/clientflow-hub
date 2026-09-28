import { beforeEach, describe, expect, it, vi } from "vitest";
import { getState, setState } from "@/lib/store";

vi.mock("@/lib/apiClient", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("@/lib/apiClient");
  return { ...actual, cfCreateEnrollment: vi.fn() };
});

import * as apiClient from "@/lib/apiClient";
import { createEnrollment } from "@/lib/api";

const serverEnrollment = {
  id: "enroll-1",
  organizationId: "org-1",
  clientId: "client-1",
  programId: "program-1",
  status: "interested",
};

describe("createEnrollment", () => {
  beforeEach(() => {
    setState((state) => ({ ...state, enrollments: [] }));
    vi.mocked(apiClient.cfCreateEnrollment).mockResolvedValue(serverEnrollment as never);
  });

  it("does not stack the same enrollment when the server answers a repeat create with the existing row", async () => {
    // The backend is idempotent per (client, program): it returns the existing row every time.
    for (let click = 0; click < 4; click += 1) {
      await createEnrollment({ clientId: "client-1", programId: "program-1" });
    }

    expect(getState().enrollments).toHaveLength(1);
    expect(getState().enrollments[0].id).toBe("enroll-1");
  });

  it("keeps other clients' enrollments and puts the new one first", async () => {
    setState((state) => ({
      ...state,
      enrollments: [{ ...serverEnrollment, id: "enroll-9", clientId: "client-9" } as never],
    }));

    await createEnrollment({ clientId: "client-1", programId: "program-1" });

    expect(getState().enrollments.map((e) => e.id)).toEqual(["enroll-1", "enroll-9"]);
  });
});
