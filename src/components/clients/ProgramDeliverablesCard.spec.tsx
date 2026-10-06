import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgramDeliverablesCard } from "./ProgramDeliverablesCard";

const getCurrent = vi.fn();
const history = vi.fn();
const getCycle = vi.fn();
const finalize = vi.fn();
const updateItem = vi.fn();
const setNext = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  cfGetCurrentDeliverables: (...a: unknown[]) => getCurrent(...a),
  cfListDeliverableHistory: (...a: unknown[]) => history(...a),
  cfGetDeliverableCycle: (...a: unknown[]) => getCycle(...a),
  cfFinalizeDeliverableCycle: (...a: unknown[]) => finalize(...a),
  cfUpdateEnrollmentDeliverable: (...a: unknown[]) => updateItem(...a),
  cfSetDeliverableNextAction: (...a: unknown[]) => setNext(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// jsdom lacks ResizeObserver, which Radix's checkbox measures with.
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
// …nor scrollIntoView, which Radix's select uses to show the chosen option.
Element.prototype.scrollIntoView ??= () => {};

const item = (id: string, title: string, status: string, extra: object = {}) => ({
  id,
  cycleId: "cy1",
  enrollmentId: "e1",
  titleSnapshot: title,
  descriptionSnapshot: null,
  sortOrder: 0,
  status,
  scheduledFor: null,
  completedAt: null,
  notes: null,
  outcome: null,
  isNextAction: false,
  ...extra,
});
const cycle = (status = "OPEN") => ({
  id: "cy1",
  enrollmentId: "e1",
  cadence: "MONTHLY",
  periodStart: "2026-10-01T04:00:00.000Z",
  periodEnd: "2026-11-01T03:59:59.999Z",
  label: "October 2026",
  status,
  finalizedAt: status === "FINALIZED" ? "2026-11-02T12:00:00.000Z" : null,
  finalizedByDisplayName: status === "FINALIZED" ? "Jordan Lee" : null,
});
const items = [
  item("d1", "LIVE Grant Giveaway", "DELIVERED"),
  item("d2", "Brand Exposure & Visibility", "COMPLETED"),
  item("d3", "Monthly Event", "COMPLETED"),
  item("d4", "B2B Relationship Opportunities", "DELIVERED"),
  item("d5", "Vetted Grant Opportunities", "DELIVERED", { notes: "Shared four opportunities" }),
  item("d6", "IDI Member Fund Opportunities", "AVAILABLE"),
  item("d7", "EAM/IDI Grant Opportunities", "NOT_APPLICABLE", {
    notes: "No applicable opportunity this month.",
  }),
];
const view = (status = "OPEN") => ({
  cycle: cycle(status),
  items,
  summary: { total: 7, deliveredOrCompleted: 5, available: 1, notApplicable: 1, open: 1 },
  nextAction: null,
  reason: null,
});

const renderCard = () =>
  render(
    <ProgramDeliverablesCard
      enrollmentId="e1"
      clientName="Moonlight Minerals"
      programName="The Inspired Detroit Initiative"
    />,
  );

beforeEach(() => {
  getCurrent.mockResolvedValue(view());
  updateItem.mockResolvedValue({});
  setNext.mockResolvedValue({});
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ProgramDeliverablesCard", () => {
  it("shows the month with delivered and not applicable counted separately", async () => {
    renderCard();
    expect(await screen.findByText("October 2026")).toBeTruthy();
    expect(screen.getByText("5 of 7 delivered · 1 not applicable")).toBeTruthy();
    expect(screen.getByText("Not applicable this period")).toBeTruthy();
  });

  it("marks something delivered without a date, with notes and outcome", async () => {
    renderCard();
    fireEvent.click(
      await screen.findByRole("button", { name: "Update IDI Member Fund Opportunities" }),
    );
    const dialog = await screen.findByRole("dialog");
    fireEvent.keyDown(within(dialog).getByRole("combobox", { name: "Status" }), { key: "Enter" });
    fireEvent.click(await screen.findByRole("option", { name: "Delivered" }));
    fireEvent.change(within(dialog).getByLabelText("Notes"), {
      target: { value: "Sent the application" },
    });
    fireEvent.change(within(dialog).getByLabelText("Outcome"), { target: { value: "1 applied" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateItem).toHaveBeenCalledWith("e1", "d6", {
        status: "DELIVERED",
        notes: "Sent the application",
        outcome: "1 applied",
      }),
    );
    expect(setNext).not.toHaveBeenCalled();
    await waitFor(() => expect(getCurrent).toHaveBeenCalledTimes(2));
  });

  it("schedules an item and sets it as the next action", async () => {
    getCurrent.mockResolvedValue({
      ...view(),
      items: [item("d1", "LIVE Grant Giveaway", "NOT_STARTED")],
    });
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Update LIVE Grant Giveaway" }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByLabelText("Date (optional)"), {
      target: { value: "2026-10-21" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox"));
    fireEvent.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateItem).toHaveBeenCalledWith("e1", "d1", { scheduledFor: "2026-10-21" }),
    );
    await waitFor(() => expect(setNext).toHaveBeenCalledWith("e1", "d1"));
  });

  it("builds the month's report from its records", async () => {
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "View report" }));
    const report = await screen.findByRole("dialog");
    expect(within(report).getByText("October 2026 Program Delivery Report")).toBeTruthy();
    expect(within(report).getByText("Client: Moonlight Minerals")).toBeTruthy();
    expect(within(report).getByText("7 deliverables tracked")).toBeTruthy();
    expect(within(report).getByText("5 delivered/completed")).toBeTruthy();
    expect(within(report).getByText("1 available")).toBeTruthy();
    expect(within(report).getByText("1 not applicable")).toBeTruthy();
    expect(within(report).getByText("No applicable opportunity this month.")).toBeTruthy();
  });

  it("finalizes the month after a confirmation, then it is read-only", async () => {
    finalize.mockResolvedValue(cycle("FINALIZED"));
    renderCard();
    fireEvent.click(await screen.findByRole("button", { name: "Finalize month" }));
    getCurrent.mockResolvedValue(view("FINALIZED"));
    fireEvent.click(screen.getByRole("button", { name: "Finalize October 2026" }));

    await waitFor(() => expect(finalize).toHaveBeenCalledWith("e1", "cy1"));
    expect(await screen.findByText(/Finalized/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Update / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Finalize month" })).toBeNull();
  });

  it("opens a past month from History", async () => {
    history.mockResolvedValue([
      { ...cycle("FINALIZED"), id: "cy0", label: "September 2026", summary: view().summary },
    ]);
    getCycle.mockResolvedValue({
      ...view("FINALIZED"),
      cycle: { ...cycle("FINALIZED"), id: "cy0", label: "September 2026" },
    });
    renderCard();
    await screen.findByText("October 2026");
    fireEvent.click(screen.getByRole("button", { name: "History" }));
    fireEvent.click(await screen.findByRole("button", { name: /September 2026/ }));

    await waitFor(() => expect(getCycle).toHaveBeenCalledWith("e1", "cy0"));
    expect(await screen.findByText("September 2026")).toBeTruthy();
    expect(screen.getByRole("button", { name: /All months/ })).toBeTruthy();
  });

  it("shows the empty state when the program has no deliverables", async () => {
    getCurrent.mockResolvedValue({
      cycle: null,
      items: [],
      summary: { total: 0, deliveredOrCompleted: 0, available: 0, notApplicable: 0, open: 0 },
      nextAction: null,
      reason: "no_deliverables_configured",
    });
    renderCard();
    expect(await screen.findByText("No program deliverables configured.")).toBeTruthy();
  });
});
