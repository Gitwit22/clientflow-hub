import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Program } from "@/types";
import { CopyProgramSetupDialog } from "./CopyProgramSetupDialog";

const copyProgramSetup = vi.fn();
const previewSetupCopy = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/api", () => ({ copyProgramSetup: (...a: unknown[]) => copyProgramSetup(...a) }));
vi.mock("@/lib/apiClient", () => ({
  cfPreviewSetupCopy: (...a: unknown[]) => previewSetupCopy(...a),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));

// jsdom lacks ResizeObserver, which Radix's checkbox measures with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const grant = { id: "p-grant", name: "Grant", isActive: false } as Program;
const programs = [grant, { id: "p-idi", name: "IDI", isActive: true } as Program];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("CopyProgramSetupDialog", () => {
  it("copies into this program from another one, and shows what was kept", async () => {
    previewSetupCopy.mockResolvedValue({
      sourceProgramId: "p-idi",
      targetProgramId: "p-grant",
      parts: [
        {
          part: "intakeQuestions",
          label: "Intake questions",
          outcome: "skip",
          detail: "This program already has its own intake questions; they are kept.",
        },
      ],
    });
    copyProgramSetup.mockResolvedValue({
      programId: "p-grant",
      sourceProgramId: "p-idi",
      replayed: false,
      parts: [
        { part: "agreements", label: "Agreements", outcome: "copy", detail: "" },
        { part: "intakeQuestions", label: "Intake questions", outcome: "skip", detail: "" },
      ],
    });
    const onCopied = vi.fn();
    render(
      <CopyProgramSetupDialog
        program={grant}
        programs={programs}
        open
        onOpenChange={vi.fn()}
        onCopied={onCopied}
      />,
    );

    // The program itself is never offered as the source.
    await screen.findByText(/they are kept/);
    expect(previewSetupCopy).toHaveBeenCalledWith(
      "p-grant",
      expect.objectContaining({ sourceProgramId: "p-idi" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Copy setup" }));

    await waitFor(() => expect(copyProgramSetup).toHaveBeenCalledTimes(1));
    expect(copyProgramSetup.mock.calls[0][0]).toBe("p-grant");
    expect(copyProgramSetup.mock.calls[0][1]).toEqual(
      expect.objectContaining({ sourceProgramId: "p-idi" }),
    );
    expect(typeof copyProgramSetup.mock.calls[0][2]).toBe("string");
    expect(toastSuccess).toHaveBeenCalledWith("Copied: Agreements. Review it before activating.");
    expect(onCopied).toHaveBeenCalled();
  });

  it("can't copy with nothing chosen", async () => {
    previewSetupCopy.mockResolvedValue({
      sourceProgramId: "p-idi",
      targetProgramId: "p-grant",
      parts: [],
    });
    render(
      <CopyProgramSetupDialog
        program={grant}
        programs={programs}
        open
        onOpenChange={vi.fn()}
        onCopied={vi.fn()}
      />,
    );
    for (const label of [
      "Journey & settings",
      "Intake questions",
      "Agreements",
      "Welcome email",
      "Deliverables",
      "Billing defaults",
      "Automatic emails",
    ]) {
      fireEvent.click(screen.getByLabelText(label));
    }
    expect((screen.getByRole("button", { name: "Copy setup" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
