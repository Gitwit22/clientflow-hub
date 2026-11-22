import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SendMultiProgramEmailDialog } from "./SendMultiProgramEmailDialog";

const previewRecipients = vi.fn();
const sendMulti = vi.fn();

vi.mock("@/lib/apiClient", () => ({
  ApiError: class ApiError extends Error {},
  cfPreviewMultiProgramEmailRecipients: (...a: unknown[]) => previewRecipients(...a),
  cfSendMultiProgramEmail: (...a: unknown[]) => sendMulti(...a),
  cfPreviewProgramEmail: vi.fn(),
  cfSendProgramEmailTest: vi.fn(),
  cfPreviewProgramEmailRecipients: vi.fn(),
  cfSendProgramEmail: vi.fn(),
}));
vi.mock("@/lib/api", () => ({ uploadStoredFile: vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const programs = [
  { id: "p-idi", name: "IDI", isActive: true },
  { id: "p-grant", name: "Grant", isActive: true },
  { id: "p-old", name: "Old Program", isActive: false },
];

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("SendMultiProgramEmailDialog", () => {
  it("emails the chosen programs once per person, in the order shown", async () => {
    previewRecipients.mockResolvedValue({
      programs: [
        { id: "p-idi", name: "IDI", recipientCount: 2, alreadyIncluded: 0 },
        { id: "p-grant", name: "Grant", recipientCount: 1, alreadyIncluded: 1 },
      ],
      recipients: [],
      skipped: [],
      recipientCount: 3,
      skippedCount: 0,
    });
    sendMulti.mockResolvedValue({
      emails: [{ recipientCount: 2 }, { recipientCount: 1 }],
      skippedPrograms: [],
      recipientCount: 3,
    });
    const onOpenChange = vi.fn();
    render(<SendMultiProgramEmailDialog programs={programs} open onOpenChange={onOpenChange} />);

    // Chosen out of order; sent in display order.
    fireEvent.click(screen.getByLabelText("Grant"));
    fireEvent.click(screen.getByLabelText("IDI"));
    await waitFor(() => expect(previewRecipients).toHaveBeenLastCalledWith(["p-idi", "p-grant"]));
    expect(await screen.findByText("3 people")).toBeTruthy();
    expect(screen.getByText(/1 already included from another program/)).toBeTruthy();

    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Update" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello all" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to 3 people" }));

    await waitFor(() => expect(sendMulti).toHaveBeenCalledTimes(1));
    expect(sendMulti.mock.calls[0][0]).toEqual({
      programIds: ["p-idi", "p-grant"],
      subject: "Update",
      body: "Hello all",
    });
    expect(typeof sendMulti.mock.calls[0][1]).toBe("string");
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("selects every program with 'All programs' and can't send before one is chosen", async () => {
    previewRecipients.mockResolvedValue({
      programs: [],
      recipients: [],
      skipped: [],
      recipientCount: 5,
      skippedCount: 0,
    });
    render(<SendMultiProgramEmailDialog programs={programs} open onOpenChange={vi.fn()} />);
    expect(screen.getByText("Choose at least one program.")).toBeTruthy();
    fireEvent.click(screen.getByLabelText("All programs"));
    await waitFor(() =>
      expect(previewRecipients).toHaveBeenLastCalledWith(["p-idi", "p-grant", "p-old"]),
    );
  });
});
