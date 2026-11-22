import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConfirmDeliverableDialog } from "./ConfirmDeliverableDialog";
import type { ProgramDeliverableTemplate } from "@/lib/program-deliverables";

const listMembers = vi.fn();
const confirm = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  cfListDeliverableConfirmationMembers: (...args: unknown[]) => listMembers(...args),
  cfConfirmDeliverableForMembers: (...args: unknown[]) => confirm(...args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const template = {
  id: "t-meeting",
  title: "Monthly meeting",
  active: true,
  cadence: "MONTHLY",
} as ProgramDeliverableTemplate;
const member = (
  enrollmentId: string,
  businessName: string,
  extra: Record<string, unknown> = {},
) => ({
  enrollmentId,
  clientId: `c-${enrollmentId}`,
  businessName,
  contactName: businessName,
  isTest: false,
  status: "NOT_STARTED",
  done: false,
  blockedReason: null,
  ...extra,
});

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  listMembers.mockResolvedValue({
    templateId: "t-meeting",
    title: "Monthly meeting",
    month: "2026-11",
    label: "November 2026",
    members: [
      member("e1", "Rivers Bakery"),
      member("e2", "Moon Minerals"),
      member("e3", "Old Shop", { done: true, status: "COMPLETED" }),
      member("e4", "Closed Co", { blockedReason: "finalized" }),
    ],
  });
  confirm.mockResolvedValue({
    templateId: "t-meeting",
    month: "2026-11",
    label: "November 2026",
    confirmed: ["e1"],
    alreadyDone: [],
    skipped: [],
  });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ConfirmDeliverableDialog", () => {
  it("starts with everyone who can be confirmed ticked; unticked members are left out", async () => {
    render(
      <ConfirmDeliverableDialog programId="p1" template={template} open onOpenChange={vi.fn()} />,
    );
    expect(await screen.findByRole("button", { name: "Confirm for 2 members" })).toBeTruthy();
    expect(screen.getByText("Already done")).toBeTruthy();
    expect(screen.getByText("Month finalized")).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "Moon Minerals" }));
    fireEvent.change(screen.getByLabelText("Note (optional)"), {
      target: { value: "Nov 12 meeting" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Confirm for 1 member" }));

    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
    expect(confirm).toHaveBeenCalledWith(
      "p1",
      "t-meeting",
      expect.objectContaining({
        enrollmentIds: ["e1"],
        status: "COMPLETED",
        note: "Nov 12 meeting",
      }),
    );
  });
});
