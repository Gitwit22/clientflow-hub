import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AddClientDialog } from "./AddClientDialog";

const createClient = vi.fn();
const findByEmail = vi.fn();
const restoreClient = vi.fn();
const navigate = vi.fn();

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));
vi.mock("@/lib/apiClient", () => ({
  acfCreateClient: (...a: unknown[]) => createClient(...a),
  acfFindClientsByEmail: (...a: unknown[]) => findByEmail(...a),
}));
vi.mock("@/lib/api", () => ({
  refreshClientProfile: vi.fn().mockResolvedValue(undefined),
  restoreClient: (...a: unknown[]) => restoreClient(...a),
}));
vi.mock("@/lib/store", () => ({
  useAppState: () => ({ authenticatedAdmin: { organizationId: "org-1" } }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const archivedMatch = {
  id: "old-1",
  contactName: "Ann Lee",
  businessName: "Ann's Bakery",
  email: "ann@example.com",
  isArchived: true,
  archivedAt: "2026-01-01T00:00:00.000Z",
  isTest: false,
};

function fillAndSubmit(options: { test?: boolean } = {}) {
  fireEvent.change(screen.getByLabelText("Contact name *"), { target: { value: "Ann Lee" } });
  fireEvent.change(screen.getByLabelText("Email *"), { target: { value: "ANN@example.com" } });
  if (options.test) fireEvent.click(screen.getByLabelText(/This is a test client/));
  fireEvent.click(
    screen.getByRole("button", { name: options.test ? "Add test client" : "Add client" }),
  );
}

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  createClient.mockResolvedValue({ client: { id: "new-1" }, emailDelivery: { status: "sent" } });
  restoreClient.mockResolvedValue(true);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AddClientDialog", () => {
  it("creates straight away when no client uses the email", async () => {
    findByEmail.mockResolvedValue({ matches: [] });
    render(<AddClientDialog open onOpenChange={vi.fn()} />);
    fillAndSubmit();
    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(1));
    expect(findByEmail).toHaveBeenCalledWith("ANN@example.com");
    expect(createClient.mock.calls[0][0]).not.toHaveProperty("isTest");
  });

  it("offers to restore an archived client with the same email instead of creating a second one", async () => {
    findByEmail.mockResolvedValue({ matches: [archivedMatch] });
    const onOpenChange = vi.fn();
    render(<AddClientDialog open onOpenChange={onOpenChange} />);
    fillAndSubmit();

    await screen.findByText("An archived client already uses this email.");
    expect(createClient).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Restore that profile" }));

    await waitFor(() => expect(restoreClient).toHaveBeenCalledWith("old-1"));
    expect(createClient).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith({
      to: "/clients/$clientId",
      params: { clientId: "old-1" },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("still lets staff create a separate client with the same email", async () => {
    findByEmail.mockResolvedValue({ matches: [archivedMatch] });
    render(<AddClientDialog open onOpenChange={vi.fn()} />);
    fillAndSubmit();
    fireEvent.click(await screen.findByRole("button", { name: "Create new anyway" }));
    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(1));
    expect(findByEmail).toHaveBeenCalledTimes(1);
    expect(restoreClient).not.toHaveBeenCalled();
  });

  it("offers to open an active client with the same email", async () => {
    findByEmail.mockResolvedValue({
      matches: [{ ...archivedMatch, isArchived: false, archivedAt: null }],
    });
    render(<AddClientDialog open onOpenChange={vi.fn()} />);
    fillAndSubmit();
    fireEvent.click(await screen.findByRole("button", { name: "Open existing" }));
    expect(navigate).toHaveBeenCalledWith({
      to: "/clients/$clientId",
      params: { clientId: "old-1" },
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("adds the client anyway when the email check fails", async () => {
    findByEmail.mockRejectedValue(new Error("offline"));
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    render(<AddClientDialog open onOpenChange={vi.fn()} />);
    fillAndSubmit();
    await waitFor(() => expect(createClient).toHaveBeenCalledTimes(1));
  });

  it("marks a test client when the box is ticked", async () => {
    findByEmail.mockResolvedValue({ matches: [] });
    render(<AddClientDialog open onOpenChange={vi.fn()} />);
    fillAndSubmit({ test: true });
    await waitFor(() =>
      expect(createClient).toHaveBeenCalledWith(expect.objectContaining({ isTest: true })),
    );
  });
});
