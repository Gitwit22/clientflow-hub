import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RecordPaymentDialog } from "./RecordPaymentDialog";

const recordPayment = vi.fn();
const recordPastPayment = vi.fn();
const listPeriods = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  cfRecordPayment: (...a: unknown[]) => recordPayment(...a),
  cfRecordPastPayment: (...a: unknown[]) => recordPastPayment(...a),
  cfListOpenBillingPeriods: (...a: unknown[]) => listPeriods(...a),
}));
vi.mock("@/lib/dates", () => ({ localToday: () => "2026-11-18" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const period = (month: string, status: string) => ({
  dueDate: `2026-${month}-01T05:00:00.000Z`,
  billingPeriodStart: `2026-${month}-01T05:00:00.000Z`,
  billingPeriodEnd: `2026-${month}-28T04:59:59.999Z`,
  amount: 100,
  paidAmount: status === "paid" ? 100 : 0,
  status,
});

function renderDialog(props: { hasAgreement?: boolean } = {}) {
  const onSaved = vi.fn();
  render(
    <RecordPaymentDialog
      open
      onOpenChange={vi.fn()}
      clientId="c1"
      enrollmentId="e1"
      hasAgreement={props.hasAgreement ?? true}
      agreementAmount={100}
      onSaved={onSaved}
    />,
  );
  return { onSaved };
}

const saveButton = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
const pastBox = () => screen.getByRole("checkbox", { name: /This is a past payment/ });

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  recordPayment.mockResolvedValue({ id: "pay-1" });
  recordPastPayment.mockResolvedValue({ id: "pay-2" });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RecordPaymentDialog", () => {
  it("records a scheduled payment against the first open period", async () => {
    listPeriods.mockResolvedValue([
      period("10", "paid"),
      period("11", "overdue"),
      period("12", "due"),
    ]);
    const { onSaved } = renderDialog();
    await screen.findByRole("combobox", { name: "Applies to period" });
    fireEvent.click(saveButton("Record payment"));

    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1));
    const [clientId, enrollmentId, data, key] = recordPayment.mock.calls[0];
    expect([clientId, enrollmentId]).toEqual(["c1", "e1"]);
    expect(data).toEqual({
      amount: 100,
      paymentDate: "2026-11-18",
      paymentMethod: "ach",
      note: undefined,
      billingPeriodStart: "2026-11-01T05:00:00.000Z",
      billingPeriodEnd: "2026-11-28T04:59:59.999Z",
    });
    expect(typeof key).toBe("string");
    expect(recordPastPayment).not.toHaveBeenCalled();
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("records a past payment, with no billing period, when the box is ticked", async () => {
    listPeriods.mockResolvedValue([period("12", "due")]);
    renderDialog();
    await screen.findByRole("combobox", { name: "Applies to period" });
    fireEvent.click(pastBox());
    expect(screen.queryByRole("combobox", { name: "Applies to period" })).toBeNull();
    fireEvent.change(screen.getByLabelText("Date paid"), { target: { value: "2025-03-15" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("Note (optional)"), {
      target: { value: " March workshop " },
    });
    fireEvent.click(saveButton("Record past payment"));

    await waitFor(() => expect(recordPastPayment).toHaveBeenCalledTimes(1));
    expect(recordPastPayment.mock.calls[0][2]).toEqual({
      amount: 150,
      paymentDate: "2025-03-15",
      paymentMethod: "ach",
      note: "March workshop",
    });
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("locks the box on when there is no payment agreement, and never loads periods", async () => {
    renderDialog({ hasAgreement: false });
    expect((pastBox() as HTMLButtonElement).disabled).toBe(true);
    expect(pastBox().getAttribute("data-state")).toBe("checked");
    expect(screen.getByText(/No payment schedule yet/)).toBeTruthy();
    expect(listPeriods).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "40" } });
    fireEvent.click(saveButton("Record past payment"));
    await waitFor(() => expect(recordPastPayment).toHaveBeenCalledTimes(1));
    expect(recordPastPayment.mock.calls[0][2]).toEqual(
      expect.objectContaining({ amount: 40, paymentMethod: "check" }),
    );
  });

  it("explains an empty period list instead of showing an empty dropdown, and offers past payment", async () => {
    listPeriods.mockResolvedValue([period("11", "paid"), period("12", "paid")]);
    renderDialog();
    expect(await screen.findByText(/through Dec 2026 is already paid/)).toBeTruthy();
    expect(saveButton("Record payment").disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Record it as a past payment instead" }));
    expect(pastBox().getAttribute("data-state")).toBe("checked");
    expect(saveButton("Record past payment").disabled).toBe(false);
  });

  it("refuses a future date", async () => {
    listPeriods.mockResolvedValue([period("12", "due")]);
    renderDialog();
    await screen.findByRole("combobox", { name: "Applies to period" });
    fireEvent.change(screen.getByLabelText("Date paid"), { target: { value: "2026-12-01" } });
    expect(screen.getByRole("alert").textContent).toMatch(/can't be dated in the future/);
    expect(saveButton("Record payment").disabled).toBe(true);
  });

  it("saves only once on a double-click", async () => {
    listPeriods.mockResolvedValue([period("12", "due")]);
    let finish: (value: unknown) => void = () => undefined;
    recordPayment.mockReturnValue(new Promise((resolve) => (finish = resolve)));
    renderDialog();
    await screen.findByRole("combobox", { name: "Applies to period" });
    const button = saveButton("Record payment");
    fireEvent.click(button);
    fireEvent.click(button);
    finish({ id: "pay-1" });
    await waitFor(() => expect(recordPayment).toHaveBeenCalledTimes(1));
  });
});
