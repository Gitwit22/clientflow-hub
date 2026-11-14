import { describe, expect, it } from "vitest";
import { formatMoney } from "./money";

describe("formatMoney", () => {
  it("formats numbers to the cent, or whole dollars for summary tiles", () => {
    expect(formatMoney(1234.5)).toBe("$1,234.50");
    expect(formatMoney(1234.5, { whole: true })).toBe("$1,235");
    expect(formatMoney(0)).toBe("$0.00");
  });

  it("shows amounts sent as numeric text instead of a false $0.00", () => {
    expect(formatMoney("1200.00")).toBe("$1,200.00");
    expect(formatMoney("250.25")).toBe("$250.25");
  });

  it("shows $0.00 for missing or non-numeric values", () => {
    expect(formatMoney(null)).toBe("$0.00");
    expect(formatMoney(undefined)).toBe("$0.00");
    expect(formatMoney(Number.NaN)).toBe("$0.00");
    expect(formatMoney("")).toBe("$0.00");
    expect(formatMoney("abc")).toBe("$0.00");
  });
});
