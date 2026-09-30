import { describe, expect, it } from "vitest";
import { isLiveMonitoring, monitoringBucket } from "./monitoring-buckets";

// Noon local time, so "today" boundaries are unambiguous in any timezone.
const now = new Date(2026, 8, 30, 12, 0, 0).getTime();
const at = (days: number, hours = 12) => new Date(2026, 8, 30 + days, hours).toISOString();

describe("monitoringBucket", () => {
  it.each([
    ["earlier today (still due today, not overdue)", at(0, 8), "today"],
    ["later today", at(0, 20), "today"],
    ["yesterday", at(-1), "overdue"],
    ["tomorrow", at(1), "week"],
    ["in 7 days", at(7), "week"],
    ["in 8 days", at(8), "upcoming"],
  ])("an item due %s", (_label, nextReviewAt, bucket) => {
    expect(monitoringBucket({ active: true, nextReviewAt }, now)).toBe(bucket);
  });

  it("puts every item in exactly one bucket (tomorrow is not also 'today')", () => {
    expect(monitoringBucket({ active: true, nextReviewAt: at(1, 1) }, now)).toBe("week");
  });

  it("separates unscheduled items from finished ones", () => {
    expect(monitoringBucket({ active: true, nextReviewAt: null }, now)).toBe("unscheduled");
    expect(
      monitoringBucket({ active: true, nextReviewAt: null, lastReviewedAt: at(-2) }, now),
    ).toBe("done");
    expect(monitoringBucket({ active: false, nextReviewAt: at(-5) }, now)).toBe("done");
  });
});

describe("isLiveMonitoring", () => {
  const enrollments = [
    { id: "open", status: "active" },
    { id: "closed", status: "completed" },
    { id: "archived", status: "active", isArchived: true },
  ];
  it("keeps only monitoring on open, unarchived enrollments", () => {
    expect(isLiveMonitoring({ enrollmentId: "open" }, enrollments)).toBe(true);
    expect(isLiveMonitoring({ enrollmentId: "closed" }, enrollments)).toBe(false);
    expect(isLiveMonitoring({ enrollmentId: "archived" }, enrollments)).toBe(false);
    expect(isLiveMonitoring({ enrollmentId: "missing" }, enrollments)).toBe(false);
  });
});
