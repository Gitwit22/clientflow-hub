import { describe, expect, it } from "vitest";
import {
  deliverableStatusLine,
  progressLabel,
  type EnrollmentDeliverable,
} from "./program-deliverables";

const base = {
  id: "d",
  cycleId: "c",
  enrollmentId: "e",
  titleSnapshot: "T",
  descriptionSnapshot: null,
  sortOrder: 0,
  scheduledFor: null,
  completedAt: null,
  notes: null,
  outcome: null,
  isNextAction: false,
} satisfies Omit<EnrollmentDeliverable, "status">;

describe("program deliverable labels", () => {
  it("never says everything was delivered when something was not applicable", () => {
    expect(
      progressLabel({ total: 7, deliveredOrCompleted: 6, available: 0, notApplicable: 1, open: 0 }),
    ).toBe("6 of 7 delivered · 1 not applicable");
    expect(
      progressLabel({ total: 7, deliveredOrCompleted: 4, available: 2, notApplicable: 0, open: 3 }),
    ).toBe("4 of 7 delivered");
  });

  it("describes a deliverable's status with its optional date and outcome", () => {
    expect(
      deliverableStatusLine({
        ...base,
        status: "SCHEDULED",
        scheduledFor: "2026-10-21T00:00:00.000Z",
      }),
    ).toBe("Scheduled · Oct 21");
    expect(deliverableStatusLine({ ...base, status: "DELIVERED", outcome: "4 shared" })).toBe(
      "Delivered · 4 shared",
    );
    expect(deliverableStatusLine({ ...base, status: "COMPLETED" })).toBe("Completed");
    expect(deliverableStatusLine({ ...base, status: "NOT_APPLICABLE" })).toBe(
      "Not applicable this period",
    );
  });
});

describe("months with no recorded activity", () => {
  const summary = { total: 7, deliveredOrCompleted: 0, available: 0, notApplicable: 0, open: 7 };

  it("says so instead of '0 of 7 delivered'", () => {
    expect(progressLabel({ ...summary, withActivity: 0 })).toBe(
      "No activity recorded · 7 deliverables",
    );
    expect(progressLabel({ ...summary, withActivity: 1 })).toBe("0 of 7 delivered");
    // Older API responses have no activity count: keep the plain count.
    expect(progressLabel(summary)).toBe("0 of 7 delivered");
  });

  it("shows when a delivered item was completed", () => {
    const line = deliverableStatusLine({
      ...base,
      status: "DELIVERED",
      completedAt: "2026-10-21T15:00:00.000Z",
      outcome: "4 shared",
    });
    expect(line).toBe("Delivered · completed Oct 21 · 4 shared");
  });
});
