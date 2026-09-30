import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { notifyMembersChanged, useOrganizationMembers } from "./use-organization-members";

const listMembers = vi.fn();
vi.mock("@/lib/apiClient", () => ({ listMembers: (...args: unknown[]) => listMembers(...args) }));
vi.mock("@/lib/store", () => ({
  useAppState: () => ({ authenticatedAdmin: { organizationId: "org-1" } }),
}));

describe("useOrganizationMembers", () => {
  it("reloads when staff change elsewhere (invite, role, disable)", async () => {
    listMembers.mockResolvedValueOnce([{ id: "a", email: "a@x", isActive: true }]);
    const { result } = renderHook(() => useOrganizationMembers());
    await waitFor(() => expect(result.current.members).toHaveLength(1));

    listMembers.mockResolvedValueOnce([
      { id: "a", email: "a@x", isActive: true },
      { id: "b", email: "b@x", isActive: true },
    ]);
    act(() => notifyMembersChanged());
    await waitFor(() => expect(result.current.members).toHaveLength(2));
    expect(listMembers).toHaveBeenCalledTimes(2);
  });
});
