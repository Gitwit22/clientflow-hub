import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgramSetup } from "@/types";
import { ProgramSetupChecklist } from "./ProgramSetupChecklist";

const cfGetProgramSetup = vi.fn();
const updateProgram = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  cfGetProgramSetup: (...a: unknown[]) => cfGetProgramSetup(...a),
}));
vi.mock("@/lib/api", () => ({ updateProgram: (...a: unknown[]) => updateProgram(...a) }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const item = (
  key: ProgramSetup["items"][number]["key"],
  label: string,
  required: boolean,
  done: boolean,
) => ({
  key,
  label,
  required,
  done,
  detail: `${label} detail`,
});

const notReady: ProgramSetup = {
  programId: "p1",
  isActive: false,
  ready: false,
  items: [
    item("intake_form", "Intake form", true, true),
    item("enrollment_agreement", "Enrollment agreement", true, false),
    item("deliverables", "Monthly deliverables", false, false),
  ],
  missingRequired: [item("enrollment_agreement", "Enrollment agreement", true, false)],
};

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

describe("ProgramSetupChecklist", () => {
  it("lists required and optional items and can't activate until required ones are done", async () => {
    cfGetProgramSetup.mockResolvedValue(notReady);
    render(<ProgramSetupChecklist programId="p1" refreshKey={0} onActivated={vi.fn()} />);
    expect(await screen.findByText("1 required item left")).toBeTruthy();
    expect(screen.getByText("Enrollment agreement detail")).toBeTruthy();
    expect(screen.getAllByText("Optional")).toHaveLength(1);
    expect(
      (screen.getByRole("button", { name: "Activate program" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("activates a ready program", async () => {
    cfGetProgramSetup.mockResolvedValue({ ...notReady, ready: true, missingRequired: [] });
    updateProgram.mockResolvedValue({});
    const onActivated = vi.fn();
    render(<ProgramSetupChecklist programId="p1" refreshKey={0} onActivated={onActivated} />);
    fireEvent.click(await screen.findByRole("button", { name: "Activate program" }));
    await waitFor(() => expect(updateProgram).toHaveBeenCalledWith("p1", { isActive: true }));
    await waitFor(() => expect(onActivated).toHaveBeenCalled());
  });

  it("warns when an active program is missing required setup, without offering activation", async () => {
    cfGetProgramSetup.mockResolvedValue({ ...notReady, isActive: true });
    render(<ProgramSetupChecklist programId="p1" refreshKey={0} onActivated={vi.fn()} />);
    expect((await screen.findByRole("alert")).textContent).toContain(
      "active but is missing required setup",
    );
    expect(screen.queryByRole("button", { name: "Activate program" })).toBeNull();
  });

  it("starts open with Go-to links for what still needs attention", async () => {
    cfGetProgramSetup.mockResolvedValue(notReady);
    const onGoTo = vi.fn();
    render(
      <ProgramSetupChecklist programId="p1" refreshKey={0} onActivated={vi.fn()} onGoTo={onGoTo} />,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Go to Agreements" }));
    expect(onGoTo).toHaveBeenCalledWith("enrollment_agreement");
    expect(screen.getByRole("button", { name: "Go to Deliverables" })).toBeTruthy();
    // Done items have no link.
    expect(screen.queryByRole("button", { name: "Go to Program questions" })).toBeNull();
  });

  it("starts closed when a program is ready and active, with its progress in one line", async () => {
    cfGetProgramSetup.mockResolvedValue({
      ...notReady,
      isActive: true,
      ready: true,
      missingRequired: [],
      items: notReady.items.map((entry) => ({ ...entry, done: entry.required })),
    });
    render(<ProgramSetupChecklist programId="p1" refreshKey={0} onActivated={vi.fn()} />);
    expect(await screen.findByText("2 of 2 required steps done. Ready and active.")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Setup checklist/ }).getAttribute("aria-expanded"),
    ).toBe("false");
  });
});
