import { describe, expect, it } from "vitest";
import type { OpenBillingPeriod } from "@/types";
import { accountStanding } from "./billing-standing";

const NOW = new Date("2026-11-22T12:00:00.000Z");
const period = (
  due: string,
  status: OpenBillingPeriod["status"],
  paidAmount = 0,
): OpenBillingPeriod => ({
  dueDate: `${due}T05:00:00.000Z`,
  billingPeriodStart: `${due}T05:00:00.000Z`,
  billingPeriodEnd: `${due}T05:00:00.000Z`,
  amount: 100,
  paidAmount,
  status,
});

describe("accountStanding", () => {
  it("is current when every due period is paid", () => {
    expect(
      accountStanding([period("2026-10-01", "paid", 100), period("2026-11-01", "paid", 100)], NOW),
    ).toEqual({
      state: "current",
      overdue: [],
      owed: 0,
    });
  });

  it("is behind by the unpaid and partly paid periods that are already due", () => {
    const result = accountStanding(
      [
        period("2026-11-01", "partial", 40),
        period("2026-09-01", "overdue"),
        period("2026-10-01", "paid", 100),
      ],
      NOW,
    );
    expect(result.state).toBe("behind");
    expect(result.overdue.map((p) => p.dueDate.slice(0, 7))).toEqual(["2026-09", "2026-11"]);
    expect(result.owed).toBe(160);
  });

  it("does not count a period that isn't due yet", () => {
    expect(
      accountStanding([period("2026-12-01", "due"), period("2026-12-01", "partial", 50)], NOW)
        .state,
    ).toBe("current");
  });
});
