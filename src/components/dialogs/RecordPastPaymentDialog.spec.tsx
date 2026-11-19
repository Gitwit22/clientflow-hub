import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RecordPastPaymentDialog } from "./RecordPastPaymentDialog";

const recordPastPayment = vi.fn();
vi.mock("@/lib/apiClient", () => ({
  cfRecordPastPayment: (...a: unknown[]) => recordPastPayment(...a),
}));
vi.mock("@/lib/dates", () => ({ localToday: () => "2026-11-18" }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RecordPastPaymentDialog", () => {
  it("records a dated past payment once, with no billing period", async () => {
    recordPastPayment.mockResolvedValue({ id: "pay-1", amount: 150 });
    const onSaved = vi.fn();
    render(
      <RecordPastPaymentDialog
        open
        onOpenChange={vi.fn()}
        clientId="c1"
        enrollmentId="e1"
        onSaved={onSaved}
      />,
    );
    const save = screen.getByRole("button", { name: "Record past payment" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Date paid"), { target: { value: "2025-03-15" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "150" } });
    fireEvent.change(screen.getByLabelText("What it was for (optional)"), {
      target: { value: " March workshop " },
    });
    fireEvent.click(save);

    await waitFor(() => expect(recordPastPayment).toHaveBeenCalledTimes(1));
    const [clientId, enrollmentId, data, key] = recordPastPayment.mock.calls[0];
    expect([clientId, enrollmentId]).toEqual(["c1", "e1"]);
    expect(data).toEqual({
      amount: 150,
      paymentDate: "2025-03-15",
      paymentMethod: "check",
      note: "March workshop",
    });
    expect(typeof key).toBe("string");
    await waitFor(() => expect(onSaved).toHaveBeenCalled());
  });

  it("refuses a future date", () => {
    render(
      <RecordPastPaymentDialog
        open
        onOpenChange={vi.fn()}
        clientId="c1"
        enrollmentId="e1"
        onSaved={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText("Date paid"), { target: { value: "2026-12-01" } });
    fireEvent.change(screen.getByLabelText("Amount"), { target: { value: "20" } });
    expect(screen.getByRole("alert").textContent).toMatch(/can't be dated in the future/);
    expect(
      (screen.getByRole("button", { name: "Record past payment" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
