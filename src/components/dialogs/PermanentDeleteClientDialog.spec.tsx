import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/types";
import { PermanentDeleteClientDialog } from "./PermanentDeleteClientDialog";

const deleteClient = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/api", () => ({
  deleteClient: (...a: unknown[]) => deleteClient(...a),
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

beforeEach(() => {
  deleteClient.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("PermanentDeleteClientDialog", () => {
  it("says payments are erased, and points to archiving to keep them", () => {
    render(<PermanentDeleteClientDialog client={client} onOpenChange={vi.fn()} />);
    expect(screen.getByText("billing agreements and payments")).toBeTruthy();
    expect(screen.getByText(/archive the client instead/)).toBeTruthy();
  });

  it("stays disabled until the business name is typed", () => {
    render(<PermanentDeleteClientDialog client={client} onOpenChange={vi.fn()} />);
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
