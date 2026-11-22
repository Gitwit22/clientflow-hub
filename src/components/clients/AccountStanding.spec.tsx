import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { OpenBillingPeriod } from "@/types";
import { AccountStanding } from "./AccountStanding";

const overdue = (month: string): OpenBillingPeriod => ({
  dueDate: `2026-${month}-15T12:00:00.000Z`,
  billingPeriodStart: `2026-${month}-15T12:00:00.000Z`,
  billingPeriodEnd: `2026-${month}-15T12:00:00.000Z`,
  amount: 100,
  paidAmount: 0,
  status: "overdue",
});

afterEach(cleanup);

describe("AccountStanding", () => {
  it("shows how far behind the client is and offers to mark earlier periods as paid", () => {
    const onCatchUp = vi.fn();
    render(
      <AccountStanding
        standing={{ state: "behind", overdue: ["06", "07", "08", "09"].map(overdue), owed: 400 }}
        onCatchUp={onCatchUp}
      />,
    );
    expect(screen.getByText("Behind")).toBeTruthy();
    expect(
      screen.getByText(/4 periods, \$400\.00 overdue \(Jun 2026, Jul 2026, Aug 2026 and 1 more\)/),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Already paid? Mark earlier periods as paid" }),
    );
    expect(onCatchUp).toHaveBeenCalledTimes(1);
  });

  it("shows Current with no catch-up link", () => {
    render(
      <AccountStanding
        standing={{ state: "current", overdue: [], owed: 0 }}
        nextDueDate="2026-12-15T12:00:00.000Z"
        onCatchUp={vi.fn()}
      />,
    );
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText(/Nothing owed so far/)).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
