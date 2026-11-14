import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/types";
import { PermanentDeleteClientDialog } from "./PermanentDeleteClientDialog";

const deleteClient = vi.fn();
const getClientDeletionEligibility = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/api", () => ({
  deleteClient: (...a: unknown[]) => deleteClient(...a),
  getClientDeletionEligibility: (...a: unknown[]) => getClientDeletionEligibility(...a),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

const client = { id: "c1", businessName: "Test Erase LLC" } as Client;
const confirmButton = () =>
  screen.getByRole("button", { name: "Delete permanently" }) as HTMLButtonElement;
const typeName = (value: string) =>
  fireEvent.change(screen.getByLabelText(/to confirm/), { target: { value } });

const allowed = { canDelete: true, reason: null, message: null, recordedPayments: 0 };

beforeEach(() => {
  deleteClient.mockResolvedValue(undefined);
  getClientDeletionEligibility.mockResolvedValue(allowed);
});

/** Waits until the eligibility check has finished and the name field is usable. */
const ready = () =>
  waitFor(() =>
    expect((screen.getByLabelText(/to confirm/) as HTMLInputElement).disabled).toBe(false),
  );
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PermanentDeleteClientDialog", () => {
  it("explains that clients with payments can't be deleted, and points to archiving", async () => {
    render(<PermanentDeleteClientDialog client={client} onOpenChange={vi.fn()} />);
    await ready();
    expect(screen.getByText(/recorded payments can.t be deleted/)).toBeTruthy();
    expect(screen.getByText(/archive the client instead/)).toBeTruthy();
    expect(getClientDeletionEligibility).toHaveBeenCalledWith("c1");
  });

  it("refuses up front for a client with recorded payments: no name field, no delete button", async () => {
    getClientDeletionEligibility.mockResolvedValue({
      canDelete: false,
      reason: "has_payments",
      message: "This client has recorded payments, so they can only be archived.",
      recordedPayments: 2,
    });
    render(<PermanentDeleteClientDialog client={client} onOpenChange={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
    expect(screen.getByText(/can only be archived/)).toBeTruthy();
    expect(screen.queryByLabelText(/to confirm/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Delete permanently" })).toBeNull();
    expect(deleteClient).not.toHaveBeenCalled();
  });

  it("still lets staff try when the check itself fails (the server enforces the rule)", async () => {
    getClientDeletionEligibility.mockRejectedValue(new Error("offline"));
    render(<PermanentDeleteClientDialog client={client} onOpenChange={vi.fn()} />);
    await ready();
    typeName("Test Erase LLC");
    expect(confirmButton().disabled).toBe(false);
  });

  it("stays disabled until the business name is typed", async () => {
    render(<PermanentDeleteClientDialog client={client} onOpenChange={vi.fn()} />);
    await ready();
    expect(confirmButton().disabled).toBe(true);
    typeName("Test Erase");
    expect(confirmButton().disabled).toBe(true);
    typeName("  test erase llc ");
    expect(confirmButton().disabled).toBe(false);
  });

  it("deletes with the typed confirmation, then closes", async () => {
    const onOpenChange = vi.fn();
    const onDeleted = vi.fn();
    render(
      <PermanentDeleteClientDialog
        client={client}
        onOpenChange={onOpenChange}
        onDeleted={onDeleted}
      />,
    );
    await ready();
    typeName("Test Erase LLC");
    fireEvent.click(confirmButton());

    await waitFor(() => expect(deleteClient).toHaveBeenCalledWith("c1", "Test Erase LLC"));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(onDeleted).toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("keeps the dialog open and shows the error when deletion fails", async () => {
    deleteClient.mockImplementation(async () => {
      throw new Error("Only organization admins can manage this organization.");
    });
    const onOpenChange = vi.fn();
    render(<PermanentDeleteClientDialog client={client} onOpenChange={onOpenChange} />);
    await ready();
    typeName("Test Erase LLC");
    fireEvent.click(confirmButton());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(
        "Only organization admins can manage this organization.",
      ),
    );
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});
