import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProgramEmailDetail, ProgramEmailSummary } from "@/lib/program-emails";
import { ProgramEmailsPanel } from "./ProgramEmailsPanel";

const cfPreviewProgramEmailRecipients = vi.fn();
const cfSendProgramEmail = vi.fn();
const cfPreviewProgramEmail = vi.fn();
const cfListProgramEmails = vi.fn();
const cfGetProgramEmail = vi.fn();
const cfRetryProgramEmail = vi.fn();

vi.mock("@/lib/apiClient", () => ({
  ApiError: class ApiError extends Error {},
  cfPreviewProgramEmailRecipients: (...a: unknown[]) => cfPreviewProgramEmailRecipients(...a),
  cfSendProgramEmail: (...a: unknown[]) => cfSendProgramEmail(...a),
  cfPreviewProgramEmail: (...a: unknown[]) => cfPreviewProgramEmail(...a),
  cfListProgramEmails: (...a: unknown[]) => cfListProgramEmails(...a),
  cfGetProgramEmail: (...a: unknown[]) => cfGetProgramEmail(...a),
  cfRetryProgramEmail: (...a: unknown[]) => cfRetryProgramEmail(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const preview = {
  program: { id: "p1", name: "IDI" },
  recipients: [
    {
      clientId: "c1",
      enrollmentId: "e1",
      businessName: "Black Economic Exchange",
      name: "Tamika",
      email: "tamika@example.com",
    },
    {
      clientId: "c2",
      enrollmentId: "e2",
      businessName: "Moonlight Minerals",
      name: "Pat",
      email: "pat@moonlight.test",
    },
  ],
  skipped: [
    { clientId: "c3", businessName: "No Email LLC", email: null, reason: "missing_email" },
    {
      clientId: "c5",
      businessName: "Shared Inbox Inc",
      email: "tamika@example.com",
      reason: "duplicate_email",
    },
  ],
  recipientCount: 2,
  skippedCount: 2,
};

const summary = (overrides: Partial<ProgramEmailSummary> = {}): ProgramEmailSummary => ({
  id: "pe1",
  programId: "p1",
  subject: "Grant day Saturday",
  body: "Hello all,\n\nSee you there.",
  sentByDisplayName: "Jordan Lee",
  status: "COMPLETED",
  createdAt: "2026-10-22T15:00:00.000Z",
  completedAt: "2026-10-22T15:01:00.000Z",
  recipientCount: 2,
  skippedCount: 2,
  counts: { pending: 0, sending: 0, accepted: 1, failed: 1 },
  ...overrides,
});

const detail = (overrides: Partial<ProgramEmailDetail> = {}): ProgramEmailDetail => ({
  ...summary(),
  recipients: [
    {
      communicationId: "m1",
      clientId: "c1",
      name: "Tamika",
      businessName: "Black Economic Exchange",
      email: "tamika@example.com",
      outcome: "accepted",
      errorCode: null,
      acceptedAt: "2026-10-22T15:00:30.000Z",
    },
    {
      communicationId: "m2",
      clientId: "c2",
      name: "Pat",
      businessName: "Moonlight Minerals",
      email: "pat@moonlight.test",
      outcome: "failed",
      errorCode: "n8n_http_400",
      acceptedAt: null,
    },
  ],
  skipped: preview.skipped as ProgramEmailDetail["skipped"],
  ...overrides,
});

describe("program emails", () => {
  beforeEach(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    cfListProgramEmails.mockResolvedValue([]);
    cfPreviewProgramEmailRecipients.mockResolvedValue(preview);
    cfGetProgramEmail.mockResolvedValue(detail());
    cfPreviewProgramEmail.mockImplementation((_programId: string, data: { subject: string }) =>
      Promise.resolve({
        programName: "IDI",
        fromName: "EA Management LLC",
        subject: data.subject,
        html: "<!DOCTYPE html><html><body><p>RENDERED</p><p>Thank you,<br/>EA Management LLC</p></body></html>",
        text: "RENDERED",
      }),
    );
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function open() {
    render(<ProgramEmailsPanel programId="p1" programName="IDI" />);
    fireEvent.click(await screen.findByRole("button", { name: "Send email blast" }));
    await screen.findByLabelText("Recipient summary");
    fireEvent.change(screen.getByLabelText("Subject"), { target: { value: "Grant day Saturday" } });
    fireEvent.change(screen.getByLabelText("Message"), { target: { value: "Hello all" } });
  }

  async function compose() {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Preview email" }));
    await screen.findByLabelText("Recipients");
  }

  it("shows every recipient and the count, plus who is skipped and why, before sending", async () => {
    await compose();
    expect(cfPreviewProgramEmailRecipients).toHaveBeenCalledWith("p1");
    expect(screen.getByLabelText("Recipient count").textContent).toBe("all 2 members");
    const list = screen.getByLabelText("Recipients");
    expect(within(list).getByText("tamika@example.com")).toBeTruthy();
    expect(within(list).getByText("pat@moonlight.test")).toBeTruthy();
    const skipped = screen.getByLabelText("Skipped members");
    expect(within(skipped).getByText("No Email LLC — No email address")).toBeTruthy();
    expect(
      within(skipped).getByText(/Shared Inbox Inc \(tamika@example.com\) — Same address/),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Send to 2 members" })).toBeTruthy();
  });

  it("sends once with an idempotency key, even when clicked twice", async () => {
    let finish: (value: ProgramEmailDetail) => void = () => {};
    cfSendProgramEmail.mockImplementation(
      () => new Promise<ProgramEmailDetail>((resolve) => (finish = resolve)),
    );
    await compose();
    const send = screen.getByRole("button", { name: "Send to 2 members" });
    fireEvent.click(send);
    fireEvent.click(send);
    finish(
      detail({ status: "SENDING", counts: { pending: 2, sending: 0, accepted: 0, failed: 0 } }),
    );
    await waitFor(() => expect(screen.queryByLabelText("Recipients")).toBeNull());

    expect(cfSendProgramEmail).toHaveBeenCalledTimes(1);
    const [programId, data, key] = cfSendProgramEmail.mock.calls[0] as [string, unknown, string];
    expect(programId).toBe("p1");
    expect(data).toEqual({ subject: "Grant day Saturday", body: "Hello all" });
    expect(key).toMatch(/.{8,}/);
  });

  it("everyone is chosen by default; unchecking narrows the email to the chosen members", async () => {
    cfSendProgramEmail.mockResolvedValue(detail({ recipientCount: 1 }));
    await open();
    expect(screen.getByLabelText("Recipient summary").textContent).toBe("All members (3)");

    fireEvent.click(screen.getByRole("button", { name: "Choose members" }));
    const members = screen.getByLabelText("Members");
    // The member sharing an address can be chosen on their own; the one without an address can't.
    expect(within(members).getAllByRole("checkbox")).toHaveLength(3);
    expect(
      within(screen.getByLabelText("Members without a usable email")).getByText(/No Email LLC/),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("checkbox", { name: "All members" }));
    expect(screen.getByLabelText("Recipient summary").textContent).toBe("Nobody chosen yet");
    expect(
      (screen.getByRole("button", { name: "Preview email" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.change(screen.getByLabelText("Search members"), { target: { value: "moon" } });
    fireEvent.click(within(members).getByRole("checkbox", { name: "Moonlight Minerals" }));
    expect(screen.getByLabelText("Recipient summary").textContent).toBe("1 of 3 chosen");

    fireEvent.click(screen.getByRole("button", { name: "Preview email" }));
    expect((await screen.findByLabelText("Recipient count")).textContent).toBe(
      "1 member you chose",
    );
    expect(screen.queryByLabelText("Skipped members")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send to 1 member" }));
    await waitFor(() => expect(cfSendProgramEmail).toHaveBeenCalledTimes(1));
    expect(cfSendProgramEmail.mock.calls[0][1]).toEqual({
      subject: "Grant day Saturday",
      body: "Hello all",
      clientIds: ["c2"],
    });
  });

  it("formats the message from the toolbar, and Preview email shows the whole email without sending", async () => {
    await open();
    const message = screen.getByLabelText("Message") as HTMLTextAreaElement;
    fireEvent.change(message, { target: { value: "Hello all\nBring ID\nBring a pen" } });
    message.setSelectionRange(0, 5);
    fireEvent.click(screen.getByRole("button", { name: "Bold" }));
    expect(message.value).toBe("**Hello** all\nBring ID\nBring a pen");
    message.setSelectionRange(14, message.value.length);
    fireEvent.click(screen.getByRole("button", { name: "Bulleted list" }));
    expect(message.value).toBe("**Hello** all\n- Bring ID\n- Bring a pen");

    fireEvent.click(screen.getByRole("button", { name: "Preview email" }));
    const frame = (await screen.findByTitle("Email as members will see it")) as HTMLIFrameElement;
    expect(cfPreviewProgramEmail).toHaveBeenCalledWith("p1", {
      subject: "Grant day Saturday",
      body: "**Hello** all\n- Bring ID\n- Bring a pen",
    });
    expect(frame.getAttribute("srcdoc")).toContain("<p>RENDERED</p>");
    expect(frame.getAttribute("sandbox")).not.toMatch(/allow-scripts/);
    const header = screen.getByLabelText("Email preview");
    expect(header.textContent).toMatch(/FromEA Management LLC/);
    expect(header.textContent).toMatch(
      /ToTamika <tamika@example.com> and 1 more, each their own copy/,
    );
    expect(header.textContent).toMatch(/SubjectGrant day Saturday/);
    expect(cfSendProgramEmail).not.toHaveBeenCalled();

    // Back to editing keeps the message.
    fireEvent.click(screen.getByRole("button", { name: "Back to editing" }));
    expect((screen.getByLabelText("Message") as HTMLTextAreaElement).value).toBe(
      "**Hello** all\n- Bring ID\n- Bring a pen",
    );
  });

  it("can send straight from the compose screen without previewing", async () => {
    cfSendProgramEmail.mockResolvedValue(detail());
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Send to 2 members" }));
    await waitFor(() => expect(cfSendProgramEmail).toHaveBeenCalledTimes(1));
    expect(cfPreviewProgramEmail).not.toHaveBeenCalled();
    expect(cfSendProgramEmail.mock.calls[0][1]).toEqual({
      subject: "Grant day Saturday",
      body: "Hello all",
    });
  });

  it("history shows partial failures clearly, never claims delivery, and retries only the failed", async () => {
    cfListProgramEmails.mockResolvedValue([summary()]);
    cfRetryProgramEmail.mockResolvedValue(detail());
    render(<ProgramEmailsPanel programId="p1" programName="IDI" />);

    const row = await screen.findByLabelText("Grant day Saturday");
    expect(within(row).getByLabelText("Outcome").textContent).toBe(
      "1 accepted · 1 failed · 2 skipped",
    );
    fireEvent.click(within(row).getByRole("button", { name: /Grant day Saturday/ }));
    const outcomes = await screen.findByLabelText("Recipient outcomes");
    expect(within(outcomes).getByText("Accepted by email provider")).toBeTruthy();
    expect(
      within(outcomes).getByText(/Failed — The email service turned it down \(n8n_http_400\)/),
    ).toBeTruthy();
    expect(screen.queryByText(/delivered/i)).toBeNull();

    fireEvent.click(within(row).getByRole("button", { name: "Retry failed (1)" }));
    await waitFor(() => expect(cfRetryProgramEmail).toHaveBeenCalledWith("pe1"));
  });
});
