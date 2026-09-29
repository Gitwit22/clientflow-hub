import { describe, expect, it } from "vitest";
import {
  CLIENT_TABS,
  CLIENT_TAB_LABELS,
  inSelectedEnrollment,
  needsSearchNormalization,
  parseClientProfileSearch,
  resolveSelectedEnrollmentId,
} from "./client-profile";
import { uniqueEnrollments } from "./enrollment-status";

const enrollment = (id: string, programId: string, status = "active") => ({
  id,
  programId,
  status,
});

describe("CLIENT_TABS", () => {
  it("is the canonical ten-tab set, in order, with a label for each", () => {
    expect(CLIENT_TABS).toEqual([
      "overview",
      "program",
      "billing",
      "forms",
      "contracts",
      "documents",
      "communications",
      "monitoring",
      "final",
      "activity",
    ]);
    expect(CLIENT_TABS.map((tab) => CLIENT_TAB_LABELS[tab])).toEqual([
      "Overview",
      "Program",
      "Billing",
      "Forms",
      "Contracts",
      "Documents",
      "Communications",
      "Monitoring",
      "Final Report",
      "Activity",
    ]);
  });
});

describe("parseClientProfileSearch", () => {
  it("keeps known values", () => {
    expect(parseClientProfileSearch({ enrollmentId: "e1", tab: "billing" })).toEqual({
      enrollmentId: "e1",
      programId: undefined,
      tab: "billing",
    });
  });

  it("accepts every canonical tab", () => {
    for (const tab of CLIENT_TABS) expect(parseClientProfileSearch({ tab }).tab).toBe(tab);
  });

  it("degrades bad input to the defaults", () => {
    expect(parseClientProfileSearch({ tab: "nope", enrollmentId: 5, programId: "" })).toEqual({
      enrollmentId: undefined,
      programId: undefined,
      tab: undefined,
    });
  });

  it("keeps the legacy programId so it can be resolved and removed", () => {
    expect(parseClientProfileSearch({ programId: "p1" }).programId).toBe("p1");
  });
});

describe("resolveSelectedEnrollmentId", () => {
  it("returns undefined when the client has no enrollments", () => {
    expect(resolveSelectedEnrollmentId([], {})).toBeUndefined();
    expect(resolveSelectedEnrollmentId([], { enrollmentId: "e1" })).toBeUndefined();
  });

  it("selects the only enrollment automatically", () => {
    expect(resolveSelectedEnrollmentId([enrollment("e1", "p1")], {})).toBe("e1");
  });

  it("honors a valid enrollmentId from the URL", () => {
    const list = [enrollment("e1", "p1"), enrollment("e2", "p2")];
    expect(resolveSelectedEnrollmentId(list, { enrollmentId: "e2" })).toBe("e2");
  });

  it("falls back when the URL enrollmentId does not belong to the client", () => {
    const list = [enrollment("e1", "p1")];
    expect(resolveSelectedEnrollmentId(list, { enrollmentId: "someone-elses" })).toBe("e1");
  });

  it("resolves a legacy programId to that client's enrollment", () => {
    const list = [enrollment("e1", "p1"), enrollment("e2", "p2")];
    expect(resolveSelectedEnrollmentId(list, { programId: "p2" })).toBe("e2");
  });

  it("with several enrollments and none chosen, prefers the first active one, else the first", () => {
    expect(
      resolveSelectedEnrollmentId(
        [enrollment("e1", "p1", "withdrawn"), enrollment("e2", "p2", "active")],
        {},
      ),
    ).toBe("e2");
    expect(
      resolveSelectedEnrollmentId(
        [enrollment("e1", "p1", "withdrawn"), enrollment("e2", "p2", "declined")],
        {},
      ),
    ).toBe("e1");
  });

  it("treats duplicate copies of the same enrollment as one", () => {
    expect(resolveSelectedEnrollmentId([enrollment("e1", "p1"), enrollment("e1", "p1")], {})).toBe(
      "e1",
    );
  });
});

describe("needsSearchNormalization", () => {
  it("is true when the URL lacks or mismatches the resolved enrollment, or carries programId", () => {
    expect(needsSearchNormalization("e1", {})).toBe(true);
    expect(needsSearchNormalization("e1", { enrollmentId: "stale" })).toBe(true);
    expect(needsSearchNormalization("e1", { enrollmentId: "e1", programId: "p1" })).toBe(true);
    expect(needsSearchNormalization(undefined, { programId: "p1" })).toBe(true);
  });

  it("is false once the URL already names the selected enrollment", () => {
    expect(needsSearchNormalization("e1", { enrollmentId: "e1" })).toBe(false);
    expect(needsSearchNormalization(undefined, {})).toBe(false);
  });
});

describe("inSelectedEnrollment", () => {
  it("shows client-wide records for every enrollment and scoped records only for theirs", () => {
    expect(inSelectedEnrollment({ enrollmentId: null }, "e1")).toBe(true);
    expect(inSelectedEnrollment({}, "e1")).toBe(true);
    expect(inSelectedEnrollment({ enrollmentId: "e1" }, "e1")).toBe(true);
    expect(inSelectedEnrollment({ enrollmentId: "e2" }, "e1")).toBe(false);
  });

  it("shows everything when nothing is selected", () => {
    expect(inSelectedEnrollment({ enrollmentId: "e2" }, undefined)).toBe(true);
  });
});

describe("uniqueEnrollments", () => {
  it("dedupes by enrollment id, not by program", () => {
    const list = [
      { id: "e1", programId: "p1" },
      { id: "e1", programId: "p1" },
      { id: "e2", programId: "p1" },
    ];
    expect(uniqueEnrollments(list).map((e) => e.id)).toEqual(["e1", "e2"]);
  });
});
