import type { OpenBillingPeriod } from "@/types";

export interface AccountStanding {
  state: "current" | "behind";
  /** Periods already due that aren't fully paid, oldest first. */
  overdue: OpenBillingPeriod[];
  /** What is still owed on those periods. */
  owed: number;
}

const roundCents = (value: number) => Math.round(value * 100) / 100;

/**
 * Whether a client is up to date on their payment schedule. `periods` is the schedule up to now
 * (GET .../billing/periods pinned to now), so a period paid ahead or not yet due never counts.
 * A period counts as overdue once it is due and not fully paid, partly paid included.
 */
export function accountStanding(
  periods: readonly OpenBillingPeriod[],
  now: Date = new Date(),
): AccountStanding {
  const overdue = periods
    .filter(
      (period) =>
        period.status === "overdue" ||
        (period.status === "partial" && new Date(period.dueDate) <= now),
    )
    .sort((a, b) => Date.parse(a.dueDate) - Date.parse(b.dueDate));
  const owed = roundCents(
    overdue.reduce((sum, period) => sum + Math.max(0, period.amount - period.paidAmount), 0),
  );
  return { state: overdue.length ? "behind" : "current", overdue, owed };
}
