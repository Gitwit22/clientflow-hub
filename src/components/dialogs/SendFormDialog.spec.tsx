import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/types";
import { SendFormDialog } from "./SendFormDialog";

const createFormAssignment = vi.fn();
const sendFormEmail = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/lib/api", () => ({
  createFormAssignment: (...args: unknown[]) => createFormAssignment(...args),
  renderEmailBody: () => "Email body",
  sendFormEmail: (...args: unknown[]) => sendFormEmail(...args),
}));

vi.mock("@/lib/store", () => ({
  useAppState: () => ({
    formTemplates: [
      {
        id: "form-1",
        name: "Master Intake",
        isActive: true,
        scope: "master_core",
        programId: null,
      },
    ],
    programs: [],
    enrollments: [],
  }),
}));

vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => toastSuccess(...args), error: vi.fn() },
}));

const client = {
  id: "client-1",
  primaryContactName: "Jordan Lee",
  businessName: "North Star Studio",
  email: "jordan@example.com",
  phone: "555-0100",
  assignedUserId: "admin-1",
  intake: { programOfInterest: "Accelerator" },
} as Client;

describe("SendFormDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    createFormAssignment.mockResolvedValue({ id: "assignment-1" });
  });

  it("disables duplicate submission while awaiting the delivery receipt", async () => {
    let resolveDelivery!: (value: unknown) => void;
    sendFormEmail.mockReturnValue(
      new Promise((resolve) => {
        resolveDelivery = resolve;
      }),
    );

    render(<SendFormDialog client={client} open onOpenChange={vi.fn()} />);

    const sendButton = screen.getByRole("button", { name: "Send form" });
    fireEvent.click(sendButton);

    const sendingButton = await screen.findByRole("button", { name: "Sending..." });
    expect((sendingButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sendingButton);
    expect(createFormAssignment).toHaveBeenCalledTimes(1);

    resolveDelivery({
      success: true,
      status: "SENT",
      message: "Form email sent successfully.",
      recipientEmail: client.email,
    });

    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith(
        "Form email sent successfully. Sent to jordan@example.com",
      ),
    );
    expect(sendFormEmail).toHaveBeenCalledTimes(1);
  });
});
