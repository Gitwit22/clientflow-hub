import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgramDeliverablesConfig } from "./ProgramDeliverablesConfig";

const list = vi.fn();
const create = vi.fn();
const update = vi.fn();
const reorder = vi.fn();
const listDates = vi.fn();
const setDate = vi.fn();
const merge = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  cfMergeProgramDeliverable: (...a: unknown[]) => merge(...a),
  cfListProgramDeliverables: (...a: unknown[]) => list(...a),
  cfCreateProgramDeliverable: (...a: unknown[]) => create(...a),
  cfUpdateProgramDeliverable: (...a: unknown[]) => update(...a),
  cfReorderProgramDeliverables: (...a: unknown[]) => reorder(...a),
  cfListProgramDeliverableDates: (...a: unknown[]) => listDates(...a),
  cfSetProgramDeliverableDate: (...a: unknown[]) => setDate(...a),
}));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() },
}));

// jsdom lacks ResizeObserver, which Radix's checkbox measures with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

const row = (
  id: string,
  title: string,
  sortOrder: number,
  active = true,
  programWideDate = false,
) => ({
  id,
  programId: "p1",
  title,
  description: null,
  cadence: "MONTHLY",
  active,
  sortOrder,
  programWideDate,
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
        programWideDate: false,
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
        programWideDate: false,
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

  it("marks a deliverable as the same date for everyone", async () => {
    update.mockResolvedValue({ ...rows[0], programWideDate: true });
    listDates.mockResolvedValue({ month: "2026-10", label: "October 2026", items: [] });
    render(<ProgramDeliverablesConfig programId="p1" />);
    await screen.findByText("Coaching Session");
    fireEvent.click(screen.getByRole("button", { name: "Edit Coaching Session" }));
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(update).toHaveBeenCalledWith("p1", "t1", {
        title: "Coaching Session",
        description: null,
        programWideDate: true,
      }),
    );
    expect(await screen.findByText("Monthly · Program date")).toBeTruthy();
    expect(await screen.findByText("Program dates")).toBeTruthy();
  });

  it("sets this month's date for everyone in Program dates", async () => {
    list.mockResolvedValue([row("t1", "Grant Day", 0, true, true), rows[1]]);
    listDates.mockResolvedValue({
      month: "2026-10",
      label: "October 2026",
      items: [{ templateId: "t1", title: "Grant Day", scheduledFor: null }],
    });
    setDate.mockResolvedValue({
      label: "October 2026",
      clientsUpdated: 5,
      scheduledFor: "2026-10-18T00:00:00.000Z",
    });
    render(<ProgramDeliverablesConfig programId="p1" />);

    const line = await screen.findByRole("listitem", { name: "Grant Day date" });
    expect(within(line).getByText("No date set for October 2026")).toBeTruthy();
    const month = listDates.mock.calls[0][1] as string;
    fireEvent.change(within(line).getByLabelText("Grant Day date for October 2026"), {
      target: { value: `${month}-18` },
    });
    fireEvent.click(within(line).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(setDate).toHaveBeenCalledWith("p1", "t1", month, `${month}-18`));
    expect(toastSuccess).toHaveBeenCalledWith(
      "Date saved for October 2026. Updated 5 member checklists.",
    );
    expect(await within(line).findByText("October 2026: October 18, 2026")).toBeTruthy();
    // Only program-wide deliverables appear there.
    expect(screen.queryByRole("listitem", { name: "Financial Review date" })).toBeNull();
  });

  it("hides Program dates when no deliverable is program-wide", async () => {
    render(<ProgramDeliverablesConfig programId="p1" />);
    await screen.findByText("Coaching Session");
    expect(screen.queryByText("Program dates")).toBeNull();
    expect(listDates).not.toHaveBeenCalled();
  });

  it("merges a deliverable into another after a preview, then reloads the list", async () => {
    const report = (applied: boolean) => ({
      applied,
      from: { id: "t1", title: "Coaching Session" },
      into: { id: "t2", title: "Financial Review" },
      items: 12,
      notesMoved: 8,
      notesKeptInPlace: 0,
      closed: 5,
      alreadyMerged: 0,
      turnedOff: true,
    });
    merge.mockImplementation((_p: string, _t: string, _i: string, apply: boolean) =>
      Promise.resolve(report(apply)),
    );
    render(<ProgramDeliverablesConfig programId="p1" />);
    const coaching = await screen.findByRole("listitem", { name: "Coaching Session" });
    fireEvent.click(within(coaching).getByRole("button", { name: "Merge into…" }));

    // The only other deliverable is chosen, and the preview shows what will change.
    const preview = await screen.findByLabelText("Merge preview");
    expect(merge).toHaveBeenCalledWith("p1", "t1", "t2", false);
    expect(preview.textContent).toMatch(/8 with notes move to “Financial Review”/);
    expect(preview.textContent).toMatch(/5 open item\(s\) are marked not applicable/);
    expect(preview.textContent).toMatch(/turned off for future months/);

    fireEvent.click(screen.getByRole("button", { name: "Merge" }));
    await waitFor(() => expect(merge).toHaveBeenCalledWith("p1", "t1", "t2", true));
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(toastSuccess).toHaveBeenCalledWith(
      "Merged “Coaching Session” into “Financial Review”: 8 note(s) moved, 5 open item(s) closed.",
    );
  });
});
