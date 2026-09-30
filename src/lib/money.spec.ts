import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("shows dollars and cents", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("rounds to whole dollars for summary tiles", () => {
    expect(formatMoney(1234.5, { whole: true })).toBe("$1,235");
  });

  it("treats missing or invalid amounts as zero", () => {
    expect(formatMoney(undefined)).toBe("$0.00");
    expect(formatMoney(Number.NaN)).toBe("$0.00");
  });
});
