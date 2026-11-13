import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Award, Client } from "@/types";
import { AwardAgreementDialog } from "./AwardAgreementDialog";

const preview = vi.fn();
const generate = vi.fn();
const send = vi.fn();
const getProgramWorkflow = vi.fn();

vi.mock("@/lib/api", () => ({ getProgramWorkflow: (...a: unknown[]) => getProgramWorkflow(...a) }));
vi.mock("@/lib/apiClient", () => ({
  ApiError: class ApiError extends Error {
    constructor(
      public readonly status: number,
      public readonly code: string,
      message: string,
    ) {
      super(message);
    }
  },
  acfPreviewAwardAgreement: (...a: unknown[]) => preview(...a),
  acfGenerateAwardAgreement: (...a: unknown[]) => generate(...a),
  acfSendContract: (...a: unknown[]) => send(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const client = { id: "c1", email: "pat@rivers.example" } as Client;
const award = {
  id: "a1",
  enrollmentId: "e1",
  programId: "p1",
  title: "Member Business Achievement Award",
  status: "approved",
  agreementTemplateId: null,
} as unknown as Award;
const reviewed = {
  purpose: "award",
  awardId: "a1",
  existingContractId: null,
  templateId: "t-award",
  versionId: "v1",
  title: "Member Fund Award Agreement",
  content: "Award Amount: $500.00\nBusiness Name: Rivers Bakery LLC",
  missing: [],
  contentHash: "c".repeat(64),
};

beforeEach(() => {
  vi.clearAllMocks();
  getProgramWorkflow.mockResolvedValue({
    contract: {
      templates: [{ id: "t-award", name: "Member Fund Award Agreement", purpose: "award" }],
    },
  });
  preview.mockResolvedValue(reviewed);
  generate.mockResolvedValue({ contract: { id: "k-award" }, awardId: "a1" });
  send.mockResolvedValue({
    contract: { id: "k-award" },
    publicContractUrl: null,
    emailDelivery: { status: "sent", sentAt: "2026-11-13T00:00:00.000Z" },
  });
});
afterEach(cleanup);

const renderDialog = (overrides: Partial<Award> = {}, onSent = vi.fn()) => {
  render(
    <AwardAgreementDialog
      award={{ ...award, ...overrides } as Award}
      client={client}
      open
      onOpenChange={vi.fn()}
      onSent={onSent}
    />,
  );
  return onSent;
};

describe("AwardAgreementDialog", () => {
  it("shows the award agreement filled in, then prepares it from that exact text and sends it", async () => {
    const onSent = renderDialog();
    expect((await screen.findByLabelText("Agreement text")).textContent).toContain(
      "Award Amount: $500.00",
    );
    fireEvent.click(screen.getByRole("button", { name: "Send agreement" }));
    await waitFor(() => expect(send).toHaveBeenCalled());
    expect(generate).toHaveBeenCalledWith("a1", {
      templateId: "t-award",
      reviewedVersionId: "v1",
      reviewedContentHash: "c".repeat(64),
    });
    expect(send).toHaveBeenCalledWith("c1", "k-award", {
      enrollmentId: "e1",
      idempotencyKey: expect.stringMatching(/^[A-Za-z0-9._:-]{8,128}$/),
    });
    await waitFor(() => expect(onSent).toHaveBeenCalled());
  });

  it("blocks sending while details are missing", async () => {
    preview.mockResolvedValue({
      ...reviewed,
      missing: [{ key: "client.contactName", label: "Client contact name" }],
    });
    renderDialog();
    expect((await screen.findByRole("alert")).textContent).toContain("Client contact name");
    expect(
      (screen.getByRole("button", { name: "Send agreement" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it("resends the agreement already in progress without preparing another", async () => {
    preview.mockResolvedValue({ ...reviewed, existingContractId: "k-open" });
    renderDialog({ status: "agreement_sent" } as Partial<Award>);
    fireEvent.click(await screen.findByRole("button", { name: "Resend signing link" }));
    await waitFor(() => expect(send).toHaveBeenCalledWith("c1", "k-open", expect.anything()));
    expect(generate).not.toHaveBeenCalled();
  });

  it("explains when the program has no award agreement yet", async () => {
    preview.mockRejectedValue(
      new Error(
        "This program has no award agreement. Add one under Agreements on the program page.",
      ),
    );
    renderDialog();
    expect((await screen.findByRole("alert")).textContent).toContain("no award agreement");
    expect(
      (screen.getByRole("button", { name: "Send agreement" }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });
});
