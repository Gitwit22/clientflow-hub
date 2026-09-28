import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/types";
import { SendIntakeDialog } from "./SendIntakeDialog";

const refreshClientCommunications = vi.fn();
const acfSendIntakeNow = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/api", () => ({
  refreshClientCommunications: (...a: unknown[]) => refreshClientCommunications(...a),
}));
vi.mock("@/lib/apiClient", () => ({ acfSendIntakeNow: (...a: unknown[]) => acfSendIntakeNow(...a) }));
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

const client = { id: "c1", email: "client@example.com" } as Client;
const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  refreshClientCommunications.mockResolvedValue([]);
  acfSendIntakeNow.mockResolvedValue({ emailDelivery: { status: "sent" } });
});
afterEach(cleanup);

describe("SendIntakeDialog", () => {
  it("sends the intake email with an idempotency key, then closes", async () => {
    const onOpenChange = vi.fn();
    render(<SendIntakeDialog client={client} open onOpenChange={onOpenChange} />);
    expect(screen.getByText("client@example.com")).toBeTruthy();

    fireEvent.click(button("Send intake email"));

    await waitFor(() => expect(acfSendIntakeNow).toHaveBeenCalledWith("c1", {
      idempotencyKey: expect.stringMatching(/^[A-Za-z0-9._:-]{8,128}$/),
    }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Intake email sent to client@example.com.");
  });

  it("a skipped or failed delivery is surfaced as an error and the dialog stays open", async () => {
    acfSendIntakeNow.mockResolvedValueOnce({ emailDelivery: { status: "skipped", reason: "disabled" } });
    const onOpenChange = vi.fn();
    render(<SendIntakeDialog client={client} open onOpenChange={onOpenChange} />);

    fireEvent.click(button("Send intake email"));

    await waitFor(() => expect(toastError).toHaveBeenCalledWith("The email was not sent (disabled)."));
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("a request error is a toast, not a crash or a navigation", async () => {
    acfSendIntakeNow.mockRejectedValueOnce(
      Object.assign(new Error("No General Intake assignment found for this client."), { status: 404 }),
    );
    const onOpenChange = vi.fn();
    render(<SendIntakeDialog client={client} open onOpenChange={onOpenChange} />);

    fireEvent.click(button("Send intake email"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("No General Intake assignment found for this client."),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it("disables the button while sending so a double click cannot send twice", async () => {
    let release!: (value: unknown) => void;
    acfSendIntakeNow.mockReturnValueOnce(new Promise((resolve) => { release = resolve; }));
    render(<SendIntakeDialog client={client} open onOpenChange={vi.fn()} />);

    fireEvent.click(button("Send intake email"));
    const sending = await screen.findByRole("button", { name: "Sending…" });
    expect((sending as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(sending);
    expect(acfSendIntakeNow).toHaveBeenCalledTimes(1);

    release({ emailDelivery: { status: "sent" } });
    await waitFor(() => expect(toastSuccess).toHaveBeenCalled());
  });
});
