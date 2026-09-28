import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, FormAssignment } from "@/types";
import { MergeResponsesDialog } from "./MergeResponsesDialog";

const previewFormResponsesForProfile = vi.fn();
const applyFormResponsesToProfile = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/api", () => ({
  previewFormResponsesForProfile: (...args: unknown[]) => previewFormResponsesForProfile(...args),
  applyFormResponsesToProfile: (...args: unknown[]) => applyFormResponsesToProfile(...args),
}));

vi.mock("sonner", () => ({
  toast: {
    success: (...args: unknown[]) => toastSuccess(...args),
    error: (...args: unknown[]) => toastError(...args),
  },
}));

const client = { id: "client-1", businessName: "Acme", intake: {} } as unknown as Client;
// Answers of every shape the backend can store; the dialog must never crash on them.
const assignment = {
  id: "assign-1",
  clientId: "client-1",
  formId: "form-1",
  status: "submitted",
  responses: { services: ["a", "b"], agree: true, budget: 5000, links: { instagram: "@x" } },
} as unknown as FormAssignment;

const changes = [
  { key: "email", label: "Email", target: "top", currentValue: "old@x.test", newValue: "new@x.test" },
  { key: "businessDescription", label: "Business description", target: "intake", currentValue: "", newValue: "Fresh" },
];

function renderDialog(onOpenChange = vi.fn()) {
  render(<MergeResponsesDialog assignment={assignment} client={client} open onOpenChange={onOpenChange} />);
  return onOpenChange;
}

const applyButton = () => screen.getByRole("button", { name: /^Apply/ }) as HTMLButtonElement;

let assignSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  previewFormResponsesForProfile.mockResolvedValue(changes);
  applyFormResponsesToProfile.mockResolvedValue({ applied: ["email", "businessDescription"] });
  // Detect any full-page navigation or reload.
  assignSpy = vi.fn();
  vi.stubGlobal("location", { ...window.location, assign: assignSpy, reload: assignSpy, replace: assignSpy });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MergeResponsesDialog", () => {
  it("asks the server for the preview of THIS client's assignment and shows the differences", async () => {
    renderDialog();
    expect(await screen.findByText("Email")).toBeTruthy();
    expect(previewFormResponsesForProfile).toHaveBeenCalledWith("client-1", "assign-1");
    expect(screen.getByText("new@x.test")).toBeTruthy();
    expect(screen.getByText("Fresh")).toBeTruthy();
  });

  it("does not crash rendering when stored answers are arrays, booleans, numbers or objects", async () => {
    // Nothing in the dialog reads assignment.responses; the server computes text values.
    expect(() => renderDialog()).not.toThrow();
    expect(await screen.findByText("Email")).toBeTruthy();
  });

  it("sends only the approved keys (not values) and the right ids, then closes and toasts", async () => {
    const onOpenChange = renderDialog();
    await screen.findByText("Email");

    fireEvent.click(screen.getByLabelText("Business description")); // untick one field
    fireEvent.click(applyButton());

    await waitFor(() => expect(applyFormResponsesToProfile).toHaveBeenCalledTimes(1));
    expect(applyFormResponsesToProfile).toHaveBeenCalledWith("client-1", "assign-1", ["email"]);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("1 field applied to profile");
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("on failure stays open, shows an error toast, and does not reload or navigate", async () => {
    applyFormResponsesToProfile.mockRejectedValueOnce(new Error("The client profile changed while applying."));
    const onOpenChange = renderDialog();
    await screen.findByText("Email");

    fireEvent.click(applyButton());

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("The client profile changed while applying."),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(screen.getByText("Email")).toBeTruthy(); // dialog content is still there
    expect(applyButton().disabled).toBe(false); // and staff can retry
    expect(assignSpy).not.toHaveBeenCalled();
  });

  it("shows an error, not a crash, when the preview cannot be loaded", async () => {
    previewFormResponsesForProfile.mockRejectedValueOnce(new Error("Form assignment not found for this client."));
    renderDialog();
    expect((await screen.findByRole("alert")).textContent).toBe("Form assignment not found for this client.");
    expect(toastError).toHaveBeenCalled();
    expect(applyButton().disabled).toBe(true);
  });

  it("says so when there is nothing to apply", async () => {
    previewFormResponsesForProfile.mockResolvedValueOnce([]);
    renderDialog();
    expect(await screen.findByText(/No differences found/)).toBeTruthy();
  });

  it("uses type=button on every button so nothing can submit a form", async () => {
    renderDialog();
    await screen.findByText("Email");
    for (const button of screen.getAllByRole("button")) {
      if (button.textContent === "Close") continue; // radix close control
      expect((button as HTMLButtonElement).type).toBe("button");
    }
  });
});
