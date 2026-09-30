import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, Communication, Contract, Program, ProgramEnrollment } from "@/types";
import { SendWelcomeDialog } from "./SendWelcomeDialog";

const getProgramWorkflow = vi.fn();
const refreshClientCommunications = vi.fn();
const acfSendWelcome = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/api", () => ({
  getProgramWorkflow: (...a: unknown[]) => getProgramWorkflow(...a),
  refreshClientCommunications: (...a: unknown[]) => refreshClientCommunications(...a),
}));
vi.mock("@/lib/apiClient", () => ({ acfSendWelcome: (...a: unknown[]) => acfSendWelcome(...a) }));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

const client = {
  id: "c1",
  email: "client@example.com",
  primaryContactName: "Client Owner",
} as Client;
const enrollment = { id: "e1", programId: "p1", clientId: "c1" } as ProgramEnrollment;
const program = { id: "p1", name: "The Inspired Detroit Initiative" } as Program;
const contract = (status: string) =>
  ({
    id: "k1",
    clientId: "c1",
    enrollmentId: "e1",
    status,
    createdAt: "2026-09-01T00:00:00.000Z",
  }) as Contract;
const welcomeComm = (overrides: Partial<Communication> = {}) =>
  ({
    id: "m1",
    clientId: "c1",
    type: "welcome_email",
    contractId: "k1",
    status: "SENT",
    date: "2026-09-21T00:00:00.000Z",
    sentAt: "2026-09-21T00:00:01.000Z",
    ...overrides,
  }) as Communication;

function renderDialog(
  contracts: Contract[],
  communications: Communication[] = [],
  onOpenChange = vi.fn(),
) {
  render(
    <SendWelcomeDialog
      client={client}
      enrollment={enrollment}
      program={program}
      contracts={contracts}
      communications={communications}
      open
      onOpenChange={onOpenChange}
    />,
  );
  return onOpenChange;
}
const button = (name: RegExp | string) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  getProgramWorkflow.mockResolvedValue({
    welcomeEmail: { activeTemplate: { name: "Inspired Detroit Welcome" } },
  });
  refreshClientCommunications.mockResolvedValue([]);
  acfSendWelcome.mockResolvedValue({
    contractId: "k1",
    emailDelivery: { status: "sent" },
    replayed: false,
  });
});
afterEach(cleanup);

describe("SendWelcomeDialog", () => {
  it("shows the program, recipient, template and status", async () => {
    renderDialog([contract("COMPLETED")]);
    expect(screen.getByText("The Inspired Detroit Initiative")).toBeTruthy();
    expect(screen.getByText("client@example.com")).toBeTruthy();
    expect(await screen.findByText("Inspired Detroit Welcome")).toBeTruthy();
    expect(screen.getByText("Not sent")).toBeTruthy();
  });

  it.each(["DRAFT", "SENT", "OPENED"])(
    "keeps the signature gate: cannot send while the contract is %s",
    (status) => {
      renderDialog([contract(status)]);
      expect(screen.getByRole("alert").textContent).toBe(
        "The contract must be signed before the welcome email can be sent.",
      );
      expect(button("Send welcome email").disabled).toBe(true);
      fireEvent.click(button("Send welcome email"));
      expect(acfSendWelcome).not.toHaveBeenCalled();
    },
  );

  it("is blocked when there is no contract at all", () => {
    renderDialog([]);
    expect(button("Send welcome email").disabled).toBe(true);
  });

  it("sends for this enrollment with an idempotency key, then closes and refreshes", async () => {
    const onOpenChange = renderDialog([contract("COMPLETED")]);

    fireEvent.click(button("Send welcome email"));

    await waitFor(() =>
      expect(acfSendWelcome).toHaveBeenCalledWith("c1", "e1", {
        idempotencyKey: expect.stringMatching(/^[A-Za-z0-9._:-]{8,128}$/),
      }),
    );
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Welcome email sent to client@example.com.");
    expect(refreshClientCommunications).toHaveBeenCalledWith("c1");
  });

  it("after a welcome went out, the action becomes Resend and the resend is a NEW attempt", async () => {
    renderDialog([contract("COMPLETED")], [welcomeComm()]);
    expect(screen.getByText(/^Sent \d/)).toBeTruthy();

    fireEvent.click(button("Resend welcome email"));
    await waitFor(() => expect(acfSendWelcome).toHaveBeenCalledTimes(1));
    fireEvent.click(button("Resend welcome email"));
    await waitFor(() => expect(acfSendWelcome).toHaveBeenCalledTimes(2));

    const keys = acfSendWelcome.mock.calls.map(
      (call) => (call[2] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("shows a previous failure so staff know a retry is needed", () => {
    renderDialog(
      [contract("COMPLETED")],
      [welcomeComm({ status: "FAILED", errorCode: "timeout", sentAt: null })],
    );
    expect(screen.getByText("Last attempt failed: timeout")).toBeTruthy();
    expect(button("Send welcome email").disabled).toBe(false);
  });

  it("a failed delivery is an error toast, the dialog stays open, and nothing navigates", async () => {
    acfSendWelcome.mockResolvedValueOnce({
      contractId: "k1",
      emailDelivery: { status: "failed", reason: "rejected" },
      replayed: false,
    });
    const onOpenChange = renderDialog([contract("COMPLETED")]);

    fireEvent.click(button("Send welcome email"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("The email was not sent (rejected)."),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(button("Send welcome email").disabled).toBe(false);
  });

  it("an API error (e.g. unsigned contract on the server) is shown, not thrown", async () => {
    acfSendWelcome.mockRejectedValueOnce(
      Object.assign(
        new Error("The contract must be signed before the welcome email can be sent."),
        { status: 400 },
      ),
    );
    const onOpenChange = renderDialog([contract("COMPLETED")]);

    fireEvent.click(button("Send welcome email"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "The contract must be signed before the welcome email can be sent.",
      ),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });
});
