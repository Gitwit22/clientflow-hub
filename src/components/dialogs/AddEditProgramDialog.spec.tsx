import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FormTemplate, Program } from "@/types";
import { AddEditProgramDialog } from "./AddEditProgramDialog";

const createProgram = vi.fn();
const updateProgram = vi.fn();
let formTemplates: Partial<FormTemplate>[] = [];

vi.mock("@/lib/api", () => ({
  createProgram: (...a: unknown[]) => createProgram(...a),
  updateProgram: (...a: unknown[]) => updateProgram(...a),
}));
vi.mock("@/lib/store", () => ({ useAppState: () => ({ formTemplates }) }));
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
});
