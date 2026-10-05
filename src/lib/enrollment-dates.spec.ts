import { describe, expect, it } from "vitest";
import {
  dateInputValue,
  enrollmentDatesLabel,
  joinedDateFromInput,
  sortByProgramHistory,
} from "./enrollment-dates";

const base = { createdAt: "2026-01-01T12:00:00.000Z", completedAt: null, withdrawnAt: null };
const day = (iso: string) => new Date(iso).toLocaleDateString();

describe("enrollment dates", () => {
  it("labels joined and ended dates", () => {
    expect(
      enrollmentDatesLabel({ ...base, status: "active", startDate: "2026-10-01T15:00:00.000Z" }),
    ).toBe(`Joined ${day("2026-10-01T15:00:00.000Z")}`);
    expect(
      enrollmentDatesLabel({
        ...base,
        status: "completed",
        startDate: "2025-03-09T12:00:00.000Z",
        completedAt: "2025-12-15T12:00:00.000Z",
      }),
    ).toBe(`Joined ${day("2025-03-09T12:00:00.000Z")} · Ended ${day("2025-12-15T12:00:00.000Z")}`);
    expect(enrollmentDatesLabel({ ...base, status: "onboarding", startDate: null })).toBe(
      "Joined: when the contract is signed",
    );
    expect(
      enrollmentDatesLabel({
        ...base,
        status: "withdrawn",
        startDate: null,
        withdrawnAt: "2026-02-01T12:00:00.000Z",
      }),
    ).toBe(`Joined: not recorded · Ended ${day("2026-02-01T12:00:00.000Z")}`);
  });

  it("lists current programs first, then past ones by most recently ended", () => {
    const sorted = sortByProgramHistory([
      { ...base, id: "old", status: "completed", startDate: null, completedAt: "2024-05-01" },
      { ...base, id: "now", status: "active", startDate: "2026-09-01" },
      { ...base, id: "recent", status: "withdrawn", startDate: null, withdrawnAt: "2025-08-01" },
      { ...base, id: "new", status: "onboarding", startDate: null, createdAt: "2026-10-01" },
    ]);
    expect(sorted.map((enrollment) => enrollment.id)).toEqual(["new", "now", "recent", "old"]);
  });

  it("round-trips a picked day through the date input", () => {
    expect(dateInputValue(joinedDateFromInput("2025-03-02"))).toBe("2025-03-02");
    expect(joinedDateFromInput("")).toBeNull();
    expect(dateInputValue(null)).toBe("");
  });
});
