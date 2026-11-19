import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Program, ProgramWorkflow } from "@/types";
import { ProgramAutomaticEmails } from "./ProgramAutomaticEmails";

const getAutomation = vi.fn();
const createEmail = vi.fn();
const updateEmail = vi.fn();
const deleteEmail = vi.fn();
const sendTest = vi.fn();
const updateWorkflow = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/apiClient", () => ({
  cfGetProgramAutomation: (...a: unknown[]) => getAutomation(...a),
  cfCreateAutomationEmail: (...a: unknown[]) => createEmail(...a),
  cfUpdateAutomationEmail: (...a: unknown[]) => updateEmail(...a),
  cfDeleteAutomationEmail: (...a: unknown[]) => deleteEmail(...a),
  cfSendAutomationEmailTest: (...a: unknown[]) => sendTest(...a),
}));
vi.mock("@/lib/api", () => ({ updateProgramWorkflow: (...a: unknown[]) => updateWorkflow(...a) }));
vi.mock("@/lib/client-send", () => ({
  describeDelivery: (delivery: { status: string }) =>
    delivery.status === "sent" ? { ok: true } : { ok: false, message: "Not sent." },
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

// jsdom lacks ResizeObserver, which Radix's switch measures with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const program = { id: "p-1", name: "Second Program", isActive: false } as Program;
const workflow = {
  config: {
    enabled: true,
    sendContractAfterIntake: true,
    sendWelcomeAfterContractSigned: true,
    activeContractTemplateId: null,
    activeContractVersionId: null,
  },
} as unknown as ProgramWorkflow;
const automation = (rules: unknown[] = []) => ({
  rules,
  emailFields: [
    { key: "client.businessName", label: "Business name", sample: "Rivers Bakery LLC" },
    { key: "program.name", label: "Program name", sample: "Program name" },
  ],
  emailTriggers: [
    { trigger: "intake_submitted", label: "When an intake is submitted" },
    { trigger: "contract_signed", label: "When the agreement is signed" },
  ],
});
const thanks = {
  id: "r-1",
  programId: "p-1",
  trigger: "intake_submitted",
  action: "send_email",
  actionConfig: { subject: "Thanks for applying", message: "We got it." },
  enabled: true,
  sortOrder: 0,
};

beforeEach(() => {
  updateWorkflow.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProgramAutomaticEmails", () => {
  it("shows the built-in emails, warns when the agreement link can't be sent, and pauses everything", async () => {
    getAutomation.mockResolvedValue(automation());
    const onChanged = vi.fn();
    render(<ProgramAutomaticEmails program={program} workflow={workflow} onChanged={onChanged} />);
    await screen.findByText(/No custom emails yet/);
    expect(screen.getByText(/No enrollment agreement is set yet/)).toBeTruthy();
    expect(screen.getByText("Always sent")).toBeTruthy();

    fireEvent.click(screen.getByLabelText("Automation for this program"));
    await waitFor(() => expect(updateWorkflow).toHaveBeenCalledWith("p-1", { enabled: false }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
  });

  it("adds a custom email with a preview from sample details, and test-sends it", async () => {
    getAutomation.mockResolvedValue(automation());
    createEmail.mockResolvedValue(thanks);
    sendTest.mockResolvedValue({
      recipientEmail: "jordan@example.org",
      delivery: { status: "sent" },
    });
    render(<ProgramAutomaticEmails program={program} workflow={workflow} onChanged={vi.fn()} />);
    await screen.findByText(/No custom emails yet/);

    fireEvent.click(screen.getByRole("button", { name: "Add email" }));
    fireEvent.change(screen.getByLabelText("Subject"), {
      target: { value: "Thanks, {{client.businessName}}" },
    });
    fireEvent.change(screen.getByLabelText("Message"), {
      target: { value: "Welcome to {{program.name}}." },
    });
    expect(screen.getByText("Thanks, Rivers Bakery LLC")).toBeTruthy();
    expect(screen.getByText("Welcome to Second Program.")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Send test to me" }));
    await waitFor(() =>
      expect(sendTest).toHaveBeenCalledWith("p-1", {
        subject: "Thanks, {{client.businessName}}",
        message: "Welcome to {{program.name}}.",
      }),
    );
    expect(toastSuccess).toHaveBeenCalledWith("Test sent to jordan@example.org.");

    fireEvent.click(screen.getAllByRole("button", { name: "Add email" }).at(-1)!);
    await waitFor(() =>
      expect(createEmail).toHaveBeenCalledWith("p-1", {
        trigger: "intake_submitted",
        subject: "Thanks, {{client.businessName}}",
        message: "Welcome to {{program.name}}.",
      }),
    );
  });

  it("switches a custom email off, and deletes one only after confirming", async () => {
    getAutomation.mockResolvedValue(automation([thanks]));
    updateEmail.mockResolvedValue({ ...thanks, enabled: false });
    deleteEmail.mockResolvedValue({ deleted: true, id: "r-1" });
    render(<ProgramAutomaticEmails program={program} workflow={workflow} onChanged={vi.fn()} />);
    await screen.findByText("Thanks for applying");
    expect(screen.getByText("When an intake is submitted")).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Send "Thanks for applying"'));
    await waitFor(() => expect(updateEmail).toHaveBeenCalledWith("p-1", "r-1", { enabled: false }));

    fireEvent.click(screen.getByRole("button", { name: "Delete" }));
    expect(deleteEmail).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Delete email" }));
    await waitFor(() => expect(deleteEmail).toHaveBeenCalledWith("p-1", "r-1"));
  });
});
