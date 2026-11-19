import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormTemplate, Program } from "@/types";
import { AddEditProgramDialog } from "./AddEditProgramDialog";

const createProgram = vi.fn();
const createProgramFromSetup = vi.fn();
const updateProgram = vi.fn();
const previewSetupCopy = vi.fn();
let formTemplates: Partial<FormTemplate>[] = [];
let programs: Partial<Program>[] = [];

vi.mock("@/lib/api", () => ({
  createProgram: (...a: unknown[]) => createProgram(...a),
  createProgramFromSetup: (...a: unknown[]) => createProgramFromSetup(...a),
  updateProgram: (...a: unknown[]) => updateProgram(...a),
}));
vi.mock("@/lib/apiClient", () => ({
  cfPreviewSetupCopy: (...a: unknown[]) => previewSetupCopy(...a),
}));
vi.mock("@/lib/store", () => ({ useAppState: () => ({ formTemplates, programs }) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// jsdom lacks ResizeObserver, which Radix's switch measures with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  formTemplates = [];
  programs = [];
});

describe("AddEditProgramDialog intake questions", () => {
  it("creates a new program with the general intake, even when every form belongs to another program", async () => {
    // Production today: every form already belongs to a program, which used to leave nothing to pick.
    formTemplates = [
      {
        id: "form-idi",
        name: "IDI questions",
        isActive: true,
        scope: "program_section",
        programId: "p-idi",
      },
    ];
    createProgram.mockResolvedValue({ id: "p-new" });
    render(<AddEditProgramDialog open onOpenChange={vi.fn()} />);

    expect(screen.getByLabelText("Intake questions").textContent).toContain("General intake only");
    expect(screen.queryByText("IDI questions")).toBeNull();
    fireEvent.change(screen.getByLabelText("Program name *"), {
      target: { value: "Second Program" },
    });
    fireEvent.submit(document.getElementById("program-form")!);

    await waitFor(() => expect(createProgram).toHaveBeenCalledTimes(1));
    expect(createProgram.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        name: "Second Program",
        defaultFormTemplateId: "general-intake",
        isActive: false,
      }),
    );
  });

  it("shows the program's own questions when editing", () => {
    formTemplates = [
      {
        id: "form-own",
        name: "Grant questions",
        isActive: true,
        scope: "program_section",
        programId: "p-grant",
      },
    ];
    const program = {
      id: "p-grant",
      name: "Grant",
      description: "",
      isActive: false,
      defaultFormTemplateId: "form-own",
      defaultMonitoringFrequency: "Monthly",
      defaultContractTemplateId: "Service Agreement",
    } as unknown as Program;
    render(<AddEditProgramDialog program={program} open onOpenChange={vi.fn()} />);
    expect(screen.getByLabelText("Intake questions").textContent).toContain("Grant questions");
  });

  it("creates a program from another program's setup with the chosen parts, once per opening", async () => {
    programs = [
      { id: "p-old", name: "Grant", isActive: false },
      { id: "p-idi", name: "IDI", isActive: true },
    ];
    previewSetupCopy.mockResolvedValue({
      sourceProgramId: "p-idi",
      targetProgramId: null,
      parts: [
        {
          part: "agreements",
          label: "Agreements",
          outcome: "copy",
          detail: '"IDI Agreement" becomes the enrollment agreement.',
        },
      ],
    });
    createProgramFromSetup.mockResolvedValue({
      programId: "p-new",
      sourceProgramId: "p-idi",
      parts: [],
      replayed: false,
    });
    render(<AddEditProgramDialog open onOpenChange={vi.fn()} />);

    fireEvent.click(screen.getByLabelText("Copy another program's setup"));
    // The active program is offered first, with every part ticked and previewed.
    expect(screen.getByLabelText("Copy setup from").textContent).toContain("IDI");
    await screen.findByText(/becomes the enrollment agreement/);
    expect(previewSetupCopy).toHaveBeenCalledWith(
      null,
      expect.objectContaining({ sourceProgramId: "p-idi" }),
    );
    // Untick billing.
    fireEvent.click(screen.getByLabelText("Billing defaults"));
    // A copied program always starts inactive, and its intake comes from the copy.
    expect(screen.queryByRole("combobox", { name: "Intake questions" })).toBeNull();
    expect(screen.queryByText("Status")).toBeNull();

    fireEvent.change(screen.getByLabelText("Program name *"), {
      target: { value: "Second Program" },
    });
    fireEvent.submit(document.getElementById("program-form")!);
    await waitFor(() => expect(createProgramFromSetup).toHaveBeenCalledTimes(1));
    const [input, key] = createProgramFromSetup.mock.calls[0];
    expect(input).toEqual(
      expect.objectContaining({ name: "Second Program", sourceProgramId: "p-idi" }),
    );
    expect(input.parts).toEqual([
      "journey",
      "intakeQuestions",
      "agreements",
      "welcomeEmail",
      "deliverables",
      "automation",
    ]);
    expect(createProgram).not.toHaveBeenCalled();

    // Submitting again (a double click or a retry) reuses the same key, so the program is created once.
    fireEvent.submit(document.getElementById("program-form")!);
    await waitFor(() => expect(createProgramFromSetup).toHaveBeenCalledTimes(2));
    expect(createProgramFromSetup.mock.calls[1][1]).toBe(key);
  });
});
