import { describe, expect, it } from "vitest";
import { isTestRecord, withoutTestRecords } from "./test-records";

describe("test records", () => {
  it("drops only rows flagged as test; rows without the flag still count", () => {
    const rows = [
      { id: "a", isDemo: true },
      { id: "b", isDemo: false },
      { id: "c" },
      { id: "d", isDemo: null },
    ];
    expect(withoutTestRecords(rows).map((row) => row.id)).toEqual(["b", "c", "d"]);
    expect(isTestRecord({ isDemo: true })).toBe(true);
    expect(isTestRecord(undefined)).toBe(false);
  });
});
