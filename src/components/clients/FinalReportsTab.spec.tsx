import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgramHistory } from "@/lib/program-deliverables";
import type { Client, FinalReport, ProgramEnrollment } from "@/types";
import { FinalReportsTab } from "./FinalReportsTab";

const saveFinalReportDraft = vi.fn();
const finalizeFinalReport = vi.fn();
const cfGetProgramHistory = vi.fn();

vi.mock("@/lib/api", () => ({
  saveFinalReportDraft: (...a: unknown[]) => saveFinalReportDraft(...a),
  finalizeFinalReport: (...a: unknown[]) => finalizeFinalReport(...a),
}));
vi.mock("@/lib/apiClient", () => ({
  ApiError: class ApiError extends Error {},
  cfGetProgramHistory: (...a: unknown[]) => cfGetProgramHistory(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const client = { id: "c1", businessName: "Moonlight Minerals" } as Client;
const enrollment = { id: "e1", programId: "p1", clientId: "c1" } as ProgramEnrollment;

const history = (status: string): ProgramHistory => ({
  enrollmentId: "e1",
  programId: "p1",
  joinedAt: null,
  endedAt: null,
  originalRequest: { assistanceRequested: "Equipment grant", budgetNeed: "$25,000" },
  months: [
    {
      cycleId: "cy1",
      recorded: true,
      label: "October 2026",
      periodStart: "2026-10-01T04:00:00.000Z",
      periodEnd: "2026-11-01T03:59:59.999Z",
      status: "FINALIZED",
      finalizedAt: null,
      summary: {
        total: 1,
        deliveredOrCompleted: status === "DELIVERED" ? 1 : 0,
        available: 0,
        notApplicable: 0,
        open: 0,
        withActivity: 1,
      },
      items: [
        {
          id: "i1",
          title: "Grant Giveaway",
          status: status as never,
          scheduledFor: null,
          completedAt: null,
          outcome: null,
        },
      ],
    },
  ],
});

const baseReport = {
  clientId: "c1",
  enrollmentId: "e1",
  programId: "p1",
  startDate: "2026-09-02T00:00:00.000Z",
  endDate: "2026-10-22T00:00:00.000Z",
  originalNeed: "Equipment grant",
  supportProvided: "IDI",
  fundingProvided: "$5,000.00",
  milestonesCompleted: "",
  resultsAchieved: "Bought a kiln",
  issuesEncountered: "",
  staffComments: "",
  clientOutcome: "",
  recommendedNextSteps: "",
  archiveDecision: "",
} satisfies Omit<FinalReport, "id">;

function renderTab(reports: FinalReport[], selected: ProgramEnrollment | null = enrollment) {
  render(
    <FinalReportsTab
      client={client}
      enrollment={selected}
      programName="IDI"
      terms={[]}
      reports={reports}
    />,
  );
}

describe("final report tab", () => {
  beforeEach(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    Element.prototype.scrollIntoView ??= () => {};
    Element.prototype.hasPointerCapture ??= () => false;
    cfGetProgramHistory.mockResolvedValue(history("DELIVERED"));
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("edits the existing draft, and finalizing needs an outcome and archives only after confirming", async () => {
    const draft = { ...baseReport, id: "r1", status: "DRAFT" } as FinalReport;
    saveFinalReportDraft.mockResolvedValue(draft);
    finalizeFinalReport.mockResolvedValue({ ...draft, status: "FINALIZED" });
    renderTab([draft]);

    expect(((await screen.findByLabelText("Results achieved")) as HTMLTextAreaElement).value).toBe(
      "Bought a kiln",
    );
    fireEvent.click(screen.getByRole("button", { name: "Finalize report & archive…" }));
    const dialog = await screen.findByRole("dialog");
    expect(dialog.textContent).toMatch(/other programs and client record stay active/);
    const confirm = within(dialog).getByRole("button", {
      name: "Finalize & archive participation",
    });
    expect((confirm as HTMLButtonElement).disabled).toBe(true); // no outcome chosen yet
    expect(finalizeFinalReport).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("combobox", { name: "Program outcome" }));
    fireEvent.click(await screen.findByRole("option", { name: "Program Complete" }));
    fireEvent.click(confirm);
    await waitFor(() => expect(finalizeFinalReport).toHaveBeenCalled());
    expect(saveFinalReportDraft.mock.calls[0]).toEqual([
      "c1",
      "e1",
      expect.objectContaining({ resultsAchieved: "Bought a kiln" }),
      "r1",
    ]);
    expect(finalizeFinalReport.mock.calls[0][1]).toEqual(
      expect.objectContaining({ outcome: "Program Complete" }),
    );
  });

  it("a finalized report shows its saved copy, not the current records, with accurate funding labels and Print", async () => {
    const finalized = {
      ...baseReport,
      id: "r2",
      status: "FINALIZED",
      archiveDecision: "Program Complete",
      finalizedAt: "2026-10-22T12:00:00.000Z",
      finalizedByDisplayName: "Jordan Lee",
      snapshot: {
        capturedAt: "2026-10-22T12:00:00.000Z",
        clientName: "Pat",
        businessName: "Moonlight Minerals",
        programName: "IDI",
        history: history("DELIVERED"),
        statedFundingNeed: "$25,000",
        termsAmount: "$5,000.00",
      },
    } as FinalReport;
    // The live records changed since; the report must not follow them.
    cfGetProgramHistory.mockResolvedValue(history("NOT_APPLICABLE"));
    renderTab([finalized]);

    const card = screen.getByLabelText("Finalized final report");
    expect(within(card).getByText(/Grant Giveaway/).parentElement?.textContent).toMatch(
      /Delivered/,
    );
    expect(cfGetProgramHistory).not.toHaveBeenCalled();
    expect(within(card).getByText("Program outcome: Program Complete")).toBeTruthy();
    expect(within(card).getByLabelText("Funding figures").textContent).toMatch(
      /Stated funding need\$25,000.*Terms amount\$5,000\.00As agreed in Terms\. Not an amount awarded\./,
    );
    expect(within(card).queryByText(/funding provided/i)).toBeNull();
    expect(within(card).getByRole("button", { name: /Print \/ Save as PDF/ })).toBeTruthy();
    // No new draft for a program whose report is finalized.
    expect(screen.getByText(/participation is archived/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save draft" })).toBeNull();
  });

  it("an older report finalized before snapshots says it shows the current records", async () => {
    renderTab(
      [{ ...baseReport, id: "r3", archiveDecision: "Contract Complete" } as FinalReport],
      null,
    );
    expect(await screen.findByText(/Finalized before reports kept their own copy/)).toBeTruthy();
    expect(screen.getByText("Not recorded with this report")).toBeTruthy();
  });

  it("Print / Save as PDF prints that report on its own", async () => {
    const print = vi.spyOn(window, "print").mockImplementation(() => {
      expect(document.body.classList.contains("printing-one")).toBe(true);
      expect(document.querySelector('[data-print-target="true"]')?.id).toBe("final-report-r4");
    });
    renderTab(
      [{ ...baseReport, id: "r4", status: "FINALIZED", snapshot: null } as FinalReport],
      null,
    );
    fireEvent.click(screen.getByRole("button", { name: /Print \/ Save as PDF/ }));
    expect(print).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("afterprint"));
    expect(document.body.classList.contains("printing-one")).toBe(false);
  });
});
