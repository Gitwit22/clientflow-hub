import type React from "react";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Award, Client, ProgramEnrollment, Terms } from "@/types";
import { FundingTab } from "./FundingTab";

const api = {
  cfListAwards: vi.fn(),
  cfCreateAward: vi.fn(),
  cfUpdateAward: vi.fn(),
  cfApproveAward: vi.fn(),
  cfCancelAward: vi.fn(),
  cfRecordAwardPayment: vi.fn(),
  cfVoidAwardPayment: vi.fn(),
};
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, hash }: { children: React.ReactNode; to: string; hash?: string }) => (
    <a href={hash ? `${to}#${hash}` : to}>{children}</a>
  ),
}));
vi.mock("@/lib/apiClient", () => ({
  cfListAwards: (...a: unknown[]) => api.cfListAwards(...a),
  cfCreateAward: (...a: unknown[]) => api.cfCreateAward(...a),
  cfUpdateAward: (...a: unknown[]) => api.cfUpdateAward(...a),
  cfApproveAward: (...a: unknown[]) => api.cfApproveAward(...a),
  cfCancelAward: (...a: unknown[]) => api.cfCancelAward(...a),
  cfRecordAwardPayment: (...a: unknown[]) => api.cfRecordAwardPayment(...a),
  cfVoidAwardPayment: (...a: unknown[]) => api.cfVoidAwardPayment(...a),
}));
const getProgramWorkflow = vi.fn();
vi.mock("@/lib/api", () => ({
  uploadDocument: vi.fn(),
  downloadDocument: vi.fn(),
  downloadExecutedContract: vi.fn(),
  getProgramWorkflow: (...a: unknown[]) => getProgramWorkflow(...a),
}));
const awardTemplate = (overrides: Record<string, unknown> = {}) => ({
  id: "tpl-award",
  name: "Grant Award Agreement",
  purpose: "award",
  isActive: true,
  signatureRequired: true,
  activeVersionId: "ver-1",
  ...overrides,
});
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const client = {
  id: "c1",
  businessName: "Rivers Bakery",
  intake: { budgetNeed: "$10,000" },
} as unknown as Client;
const enrollment = { id: "e1", programId: "p1", isArchived: false } as ProgramEnrollment;
const terms = [{ id: "t1", enrollmentId: "e1", fundingAmount: 7500 }] as unknown as Terms[];

const award = (overrides: Partial<Award> = {}): Award => ({
  id: "a1",
  clientId: "c1",
  enrollmentId: "e1",
  programId: "p1",
  title: "Growth Grant",
  source: "IDI Member Fund",
  amountAwarded: 5000,
  received: 2500,
  outstanding: 2500,
  paymentState: "partially_paid",
  awardDate: "2026-11-12T05:00:00.000Z",
  expectedPaymentDate: null,
  notes: "",
  status: "approved",
  agreementTemplateId: null,
  currentAgreementId: null,
  approvedAt: null,
  approvedByDisplayName: null,
  cancelledAt: null,
  cancelledByDisplayName: null,
  cancelReason: null,
  createdByDisplayName: "Jordan",
  createdAt: "2026-11-12T00:00:00.000Z",
  payments: [
    {
      id: "pay-1",
      awardId: "a1",
      amount: 2500,
      paymentDate: "2026-11-13T05:00:00.000Z",
      paymentMethod: "check",
      note: null,
      recordedByDisplayName: "Jordan",
      voidedAt: null,
      voidedByDisplayName: null,
      voidReason: null,
      createdAt: "2026-11-13T00:00:00.000Z",
    },
  ],
  documents: [],
  ...overrides,
});

const renderTab = (props: Partial<Parameters<typeof FundingTab>[0]> = {}) =>
  render(
    <FundingTab
      client={client}
      enrollment={enrollment}
      programName="IDI"
      terms={terms}
      {...props}
    />,
  );

beforeEach(() => {
  vi.clearAllMocks();
  api.cfListAwards.mockResolvedValue([award()]);
  getProgramWorkflow.mockResolvedValue({ contract: { templates: [awardTemplate()] } });
});
afterEach(cleanup);

describe("FundingTab", () => {
  it("shows awarded, received and still owed separately, apart from requested and proposed funding", async () => {
    renderTab();
    const card = await screen.findByLabelText("Award Growth Grant");
    expect(within(card).getByText("Awarded").nextSibling?.textContent).toBe("$5,000.00");
    expect(within(card).getByText("Received").nextSibling?.textContent).toBe("$2,500.00");
    expect(within(card).getByText("Still owed").nextSibling?.textContent).toBe("$2,500.00");
    expect(screen.getByText("$10,000")).toBeTruthy();
    expect(screen.getByText("$7,500.00")).toBeTruthy();
    expect(api.cfListAwards).toHaveBeenCalledWith("c1", "e1");
  });

  it("records a payment, refusing more than is still owed, with one key across a retry", async () => {
    api.cfRecordAwardPayment
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(award({ received: 5000, outstanding: 0, paymentState: "paid" }));
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Record payment" }));
    const amount = screen.getByLabelText("Amount paid ($)");
    fireEvent.change(amount, { target: { value: "2600" } });
    const dialogButton = () => screen.getAllByRole("button", { name: "Record payment" }).at(-1)!;
    fireEvent.click(dialogButton());
    expect(api.cfRecordAwardPayment).not.toHaveBeenCalled();

    fireEvent.change(amount, { target: { value: "2500" } });
    fireEvent.click(dialogButton());
    await waitFor(() => expect(api.cfRecordAwardPayment).toHaveBeenCalledTimes(1));
    fireEvent.click(dialogButton());
    await waitFor(() => expect(api.cfRecordAwardPayment).toHaveBeenCalledTimes(2));
    const keys = api.cfRecordAwardPayment.mock.calls.map((call) => call[2] as string);
    expect(keys[0]).toBe(keys[1]);
    expect(api.cfRecordAwardPayment.mock.calls[0][1]).toEqual(
      expect.objectContaining({ amount: 2500, paymentMethod: "check" }),
    );
  });

  it("adds an award with an idempotency key", async () => {
    api.cfListAwards.mockResolvedValue([]);
    api.cfCreateAward.mockResolvedValue(
      award({
        id: "a2",
        title: "Award 2",
        payments: [],
        received: 0,
        outstanding: 500,
        amountAwarded: 500,
      }),
    );
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Add award" }));
    fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Award 2" } });
    fireEvent.change(screen.getByLabelText("Source"), { target: { value: "IDI Member Fund" } });
    fireEvent.change(screen.getByLabelText("Amount awarded ($)"), { target: { value: "500" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Add award" }).at(-1)!);
    await waitFor(() => expect(api.cfCreateAward).toHaveBeenCalled());
    const [clientId, enrollmentId, input, key] = api.cfCreateAward.mock.calls[0];
    expect([clientId, enrollmentId]).toEqual(["c1", "e1"]);
    expect(input).toEqual(
      expect.objectContaining({ title: "Award 2", amountAwarded: 500, approve: false }),
    );
    expect(key).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
    expect(await screen.findByLabelText("Award Award 2")).toBeTruthy();
  });

  it("voids a payment only with a reason", async () => {
    api.cfVoidAwardPayment.mockResolvedValue(award({ received: 0, outstanding: 5000 }));
    renderTab();
    fireEvent.click(await screen.findByRole("button", { name: "Void" }));
    const confirm = screen.getByRole("button", { name: "Void payment" }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for voiding"), {
      target: { value: "Wrong award" },
    });
    fireEvent.click(confirm);
    await waitFor(() =>
      expect(api.cfVoidAwardPayment).toHaveBeenCalledWith("pay-1", "Wrong award"),
    );
  });

  it("does not offer new awards on an archived participation, and hides cancel once money was paid", async () => {
    renderTab({ enrollment: { ...enrollment, isArchived: true } });
    await screen.findByLabelText("Award Growth Grant");
    expect((screen.getByRole("button", { name: "Add award" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect(screen.queryByRole("button", { name: "Cancel award" })).toBeNull();
    // Payments on an existing award can still be recorded after archiving.
    expect(screen.getByRole("button", { name: "Record payment" })).toBeTruthy();
  });

  describe("award agreement steps", () => {
    it("shows the steps and the wording used, and links to edit the wording", async () => {
      renderTab();
      const steps = await screen.findByLabelText("Award agreement");
      await within(steps).findByText(/Uses .Grant Award Agreement./);
      expect(within(steps).getByLabelText("Agreement steps").textContent).toBe(
        "✓ Wording2. Review & send3. Sent4. Signed",
      );
      const edit = within(steps).getByRole("link", { name: "Edit wording" });
      expect(edit.getAttribute("href")).toBe("/programs/p1#agreements");
      const send = within(steps).getByRole("button", { name: "Review & send agreement" });
      expect((send as HTMLButtonElement).disabled).toBe(false);
    });

    it("says what blocks sending before staff click", async () => {
      getProgramWorkflow.mockResolvedValue({ contract: { templates: [] } });
      renderTab({ programActive: false });
      const steps = await screen.findByLabelText("Award agreement");
      const reasons = await within(steps).findByRole("alert");
      expect(reasons.textContent).toMatch(/program is inactive/);
      expect(reasons.textContent).toMatch(/no award agreement yet/);
      expect(within(steps).getByRole("link", { name: "Add agreement wording" })).toBeTruthy();
      expect(
        (
          within(steps).getByRole("button", {
            name: "Review & send agreement",
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(true);
    });

    it("waits for the signature before payments when the agreement needs one", async () => {
      api.cfListAwards.mockResolvedValue([
        award({ status: "agreement_sent", agreementTemplateId: "tpl-award" }),
      ]);
      renderTab();
      await screen.findByText(/Payments can be recorded once the client signs/);
      expect(screen.queryByRole("button", { name: "Record payment" })).toBeNull();
      expect(screen.getByRole("button", { name: "Resend agreement" })).toBeTruthy();
    });

    it("allows payments on a sent agreement that needs no signature", async () => {
      getProgramWorkflow.mockResolvedValue({
        contract: { templates: [awardTemplate({ signatureRequired: false })] },
      });
      api.cfListAwards.mockResolvedValue([
        award({ status: "agreement_sent", agreementTemplateId: "tpl-award" }),
      ]);
      renderTab();
      await waitFor(() =>
        expect(screen.getByRole("button", { name: "Record payment" })).toBeTruthy(),
      );
    });
  });
});
