import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client, Contract, Program, ProgramEnrollment } from "@/types";
import { SendContractDialog } from "./SendContractDialog";

const getProgramWorkflow = vi.fn();
const refreshClientContracts = vi.fn();
const refreshClientCommunications = vi.fn();
const downloadExecutedContract = vi.fn();
const acfGenerateContract = vi.fn();
const acfSendContract = vi.fn();
const acfSendContractCopy = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/api", () => ({
  getProgramWorkflow: (...a: unknown[]) => getProgramWorkflow(...a),
  refreshClientContracts: (...a: unknown[]) => refreshClientContracts(...a),
  refreshClientCommunications: (...a: unknown[]) => refreshClientCommunications(...a),
  downloadExecutedContract: (...a: unknown[]) => downloadExecutedContract(...a),
}));
vi.mock("@/lib/apiClient", () => ({
  acfGenerateContract: (...a: unknown[]) => acfGenerateContract(...a),
  acfSendContract: (...a: unknown[]) => acfSendContract(...a),
  acfSendContractCopy: (...a: unknown[]) => acfSendContractCopy(...a),
}));
vi.mock("sonner", () => ({
  toast: {
    success: (...a: unknown[]) => toastSuccess(...a),
    error: (...a: unknown[]) => toastError(...a),
  },
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: unknown; to: string }) => (
    <a href={to}>{children as never}</a>
  ),
}));

const client = { id: "c1", email: "client@example.com" } as Client;
const enrollment = { id: "e1", programId: "p1", clientId: "c1" } as ProgramEnrollment;
const program = { id: "p1", name: "The Inspired Detroit Initiative" } as Program;
const staffSigner = { name: "Jordan Lee", id: "admin-1" };
const contract = (overrides: Partial<Contract> = {}) =>
  ({
    id: "k1",
    clientId: "c1",
    enrollmentId: "e1",
    programId: "p1",
    status: "DRAFT",
    contractType: "Inspired Detroit Agreement",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  }) as Contract;

const sentOk = {
  contract: { id: "k1" },
  publicContractUrl: null,
  emailDelivery: { status: "sent", sentAt: "2026-09-28T00:00:00.000Z" },
};

function renderDialog(contracts: Contract[], onOpenChange = vi.fn()) {
  render(
    <SendContractDialog
      client={client}
      enrollment={enrollment}
      program={program}
      contracts={contracts}
      staffSigner={staffSigner}
      open
      onOpenChange={onOpenChange}
    />,
  );
  return onOpenChange;
}

const button = (name: RegExp | string) => screen.getByRole("button", { name }) as HTMLButtonElement;

beforeEach(() => {
  getProgramWorkflow.mockResolvedValue({ contract: { activeVersion: { id: "v1" } } });
  refreshClientContracts.mockResolvedValue([]);
  refreshClientCommunications.mockResolvedValue([]);
  acfGenerateContract.mockResolvedValue({
    contract: { id: "k-new" },
    publicContractUrl: "https://x/agreements/t",
  });
  acfSendContract.mockResolvedValue(sentOk);
  acfSendContractCopy.mockResolvedValue({
    contractId: "k1",
    emailDelivery: { status: "sent" },
    replayed: false,
  });
});

afterEach(cleanup);

describe("SendContractDialog: not yet drafted", () => {
  it("drafts the contract for THIS enrollment, then sends it, with an idempotency key", async () => {
    const onOpenChange = renderDialog([]);
    await waitFor(() => expect(getProgramWorkflow).toHaveBeenCalledWith("p1"));

    fireEvent.click(button("Send contract"));

    await waitFor(() => expect(acfSendContract).toHaveBeenCalledTimes(1));
    expect(acfGenerateContract).toHaveBeenCalledWith("c1", {
      staffSignerName: "Jordan Lee",
      staffSignerId: "admin-1",
      enrollmentId: "e1",
    });
    expect(acfSendContract).toHaveBeenCalledWith("c1", "k-new", {
      enrollmentId: "e1",
      idempotencyKey: expect.stringMatching(/^[A-Za-z0-9._:-]{8,128}$/),
    });
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
    expect(toastSuccess).toHaveBeenCalledWith("Contract sent to client@example.com.");
    expect(refreshClientContracts).toHaveBeenCalledWith("c1");
    expect(refreshClientCommunications).toHaveBeenCalledWith("c1");
  });

  it("says so, links to the program's contract settings and cannot send when no template is configured", async () => {
    getProgramWorkflow.mockResolvedValue({ contract: { activeVersion: null } });
    renderDialog([]);

    expect((await screen.findByRole("alert")).textContent).toBe(
      "No active contract is configured for this program.",
    );
    expect(screen.getByText("Go to Program Contract Settings")).toBeTruthy();
    expect(button("Send contract").disabled).toBe(true);
    expect(acfGenerateContract).not.toHaveBeenCalled();
  });
});

describe("SendContractDialog: an existing contract is never duplicated", () => {
  it("DRAFT: sends the existing draft without generating another", async () => {
    renderDialog([contract({ status: "DRAFT" })]);
    fireEvent.click(button("Send contract"));
    await waitFor(() => expect(acfSendContract).toHaveBeenCalledTimes(1));
    expect(acfSendContract).toHaveBeenCalledWith(
      "c1",
      "k1",
      expect.objectContaining({ enrollmentId: "e1" }),
    );
    expect(acfGenerateContract).not.toHaveBeenCalled();
    expect(getProgramWorkflow).not.toHaveBeenCalled(); // no template needed for an existing draft
  });

  it.each(["SENT", "OPENED"])(
    "%s: warns the old link stops working and resends the same contract",
    async (status) => {
      renderDialog([contract({ status, sentAt: "2026-09-10T00:00:00.000Z" })]);
      expect(screen.getByText(/The previous link stops working/)).toBeTruthy();

      fireEvent.click(button("Resend signing link"));

      await waitFor(() => expect(acfSendContract).toHaveBeenCalledTimes(1));
      expect(acfSendContract).toHaveBeenCalledWith(
        "c1",
        "k1",
        expect.objectContaining({ enrollmentId: "e1" }),
      );
      expect(acfGenerateContract).not.toHaveBeenCalled();
      expect(acfSendContractCopy).not.toHaveBeenCalled();
      await waitFor(() =>
        expect(toastSuccess).toHaveBeenCalledWith("Contract resent to client@example.com."),
      );
    },
  );
});

describe("SendContractDialog: signed contract", () => {
  const signed = () =>
    contract({
      status: "COMPLETED",
      signedAt: "2026-09-20T00:00:00.000Z",
      executedStoredFileId: "file-1",
    });

  it("only offers the signed copy, never the signing link", async () => {
    renderDialog([signed()]);
    expect(button("Send copy")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resend signing link" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Send contract" })).toBeNull();

    fireEvent.click(button("Send copy"));

    await waitFor(() => expect(acfSendContractCopy).toHaveBeenCalledTimes(1));
    expect(acfSendContractCopy).toHaveBeenCalledWith("c1", "k1", {
      idempotencyKey: expect.stringMatching(/^[A-Za-z0-9._:-]{8,128}$/),
    });
    expect(acfSendContract).not.toHaveBeenCalled();
    expect(acfGenerateContract).not.toHaveBeenCalled();
    await waitFor(() =>
      expect(toastSuccess).toHaveBeenCalledWith("Signed copy sent to client@example.com."),
    );
  });

  it("lets staff view the executed contract", () => {
    downloadExecutedContract.mockResolvedValue(undefined);
    renderDialog([signed()]);
    fireEvent.click(button("View executed contract"));
    expect(downloadExecutedContract).toHaveBeenCalledWith("c1", "k1");
  });

  it("explains and disables Send copy when the signed file was not archived", () => {
    renderDialog([
      contract({
        status: "COMPLETED",
        signedAt: "2026-09-20T00:00:00.000Z",
        executedStoredFileId: null,
      }),
    ]);
    expect(screen.getByText("The signed copy is not available yet.")).toBeTruthy();
    expect(button("Send copy").disabled).toBe(true);
  });
});

describe("SendContractDialog: failures stay on the page", () => {
  it("a failed delivery shows an error, keeps the dialog open and the next click is a new attempt", async () => {
    acfSendContract.mockResolvedValueOnce({
      ...sentOk,
      emailDelivery: { status: "failed", reason: "timeout" },
    });
    const onOpenChange = renderDialog([contract({ status: "DRAFT" })]);

    fireEvent.click(button("Send contract"));
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("The email was not sent (timeout)."),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(toastSuccess).not.toHaveBeenCalled();

    fireEvent.click(button("Send contract"));
    await waitFor(() => expect(acfSendContract).toHaveBeenCalledTimes(2));
    const keys = acfSendContract.mock.calls.map(
      (call) => (call[2] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys[0]).not.toBe(keys[1]);
  });

  it("an API error is shown as a toast and does not close the dialog or navigate", async () => {
    acfSendContract.mockRejectedValueOnce(
      Object.assign(new Error("The contract cannot be sent in its current status."), {
        status: 400,
      }),
    );
    const onOpenChange = renderDialog([contract({ status: "DRAFT" })]);

    fireEvent.click(button("Send contract"));

    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith("The contract cannot be sent in its current status."),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(button("Send contract").disabled).toBe(false);
  });

  it("after a lost response, retrying reuses the SAME key so the client is not emailed twice", async () => {
    acfSendContract.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    renderDialog([contract({ status: "DRAFT" })]);

    fireEvent.click(button("Send contract"));
    await waitFor(() => expect(toastError).toHaveBeenCalled());
    fireEvent.click(button("Send contract"));
    await waitFor(() => expect(acfSendContract).toHaveBeenCalledTimes(2));

    const keys = acfSendContract.mock.calls.map(
      (call) => (call[2] as { idempotencyKey: string }).idempotencyKey,
    );
    expect(keys[0]).toBe(keys[1]);
  });
});
