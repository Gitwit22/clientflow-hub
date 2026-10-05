import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgramDeliverablesConfig } from "./ProgramDeliverablesConfig";

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const reorder = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  cfListProgramDeliverables: (...a: unknown[]) => list(...a),
  cfCreateProgramDeliverable: (...a: unknown[]) => create(...a),
  cfUpdateProgramDeliverable: (...a: unknown[]) => update(...a),
  cfReorderProgramDeliverables: (...a: unknown[]) => reorder(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const row = (id: string, title: string, sortOrder: number, active = true) => ({
  id,
  programId: "p1",
  title,
  description: null,
  cadence: "MONTHLY",
  active,
  sortOrder,
});
const rows = [row("t1", "Coaching Session", 0), row("t2", "Financial Review", 1)];

beforeEach(() => list.mockResolvedValue(rows));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProgramDeliverablesConfig", () => {
  it("lists the program's deliverables with their cadence", async () => {
    render(<ProgramDeliverablesConfig programId="p1" />);
    const coaching = await screen.findByRole("listitem", { name: "Coaching Session" });
    expect(within(coaching).getByText("Monthly")).toBeTruthy();
    expect(list).toHaveBeenCalledWith("p1");
  });

  it("shows the empty state", async () => {
    list.mockResolvedValue([]);
    render(<ProgramDeliverablesConfig programId="p1" />);
    expect(await screen.findByText("No program deliverables configured.")).toBeTruthy();
  });

  it("adds a monthly deliverable", async () => {
    create.mockResolvedValue(row("t3", "Business Plan Update", 2));
    render(<ProgramDeliverablesConfig programId="p1" />);
    await screen.findByText("Coaching Session");
    fireEvent.click(screen.getByRole("button", { name: /Add deliverable/ }));
    fireEvent.change(screen.getByLabelText("Title"), {
      target: { value: " Business Plan Update " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(create).toHaveBeenCalledWith("p1", {
        title: "Business Plan Update",
        description: null,
        cadence: "MONTHLY",
      }),
    );
    expect(await screen.findByText("Business Plan Update")).toBeTruthy();
  });

  it("edits, reorders and disables", async () => {
    update.mockImplementation((_p: string, id: string, data: object) =>
      Promise.resolve({ ...rows.find((r) => r.id === id)!, ...data }),
    );
    reorder.mockResolvedValue([rows[1], rows[0]]);
    render(<ProgramDeliverablesConfig programId="p1" />);
    await screen.findByText("Coaching Session");

    fireEvent.click(screen.getByRole("button", { name: "Edit Coaching Session" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Coaching Call" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("p1", "t1", {
        title: "Coaching Call",
        description: null,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Move Financial Review up" }));
    await waitFor(() => expect(reorder).toHaveBeenCalledWith("p1", ["t2", "t1"]));

    const review = await screen.findByRole("listitem", { name: "Financial Review" });
    fireEvent.click(within(review).getByRole("button", { name: "Disable" }));
    await waitFor(() => expect(update).toHaveBeenCalledWith("p1", "t2", { active: false }));
    expect(
      await within(screen.getByRole("listitem", { name: "Financial Review" })).findByText(
        "Disabled",
      ),
    ).toBeTruthy();
  });
});
