import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { describeStaffEmailProblem } from "@/lib/staff-email";
import { CopyLinkDialog } from "./CopyLinkDialog";
import { InviteUserDialog } from "./InviteUserDialog";

const inviteMember = vi.fn();

vi.mock("@/lib/apiClient", () => ({
  ApiError: class ApiError extends Error {},
  inviteMember: (...a: unknown[]) => inviteMember(...a),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const link = "https://app.example.com/accept-invite?token=abc";

describe("staff invite emails", () => {
  beforeEach(() => {
    globalThis.ResizeObserver ??= class {
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function invite() {
    render(
      <InviteUserDialog open onOpenChange={() => {}} organizationId="org-1" onSuccess={() => {}} />,
    );
    fireEvent.change(screen.getByLabelText(/First name/), { target: { value: "Dana" } });
    fireEvent.change(screen.getByLabelText(/Email/), { target: { value: "dana@example.com" } });
    fireEvent.click(screen.getByRole("button", { name: "Send invitation" }));
    await waitFor(() => expect(inviteMember).toHaveBeenCalled());
  }

  it("says the invitation was emailed and still offers the link", async () => {
    inviteMember.mockResolvedValue({
      message: "ok",
      inviteUrl: link,
      expiresInHours: 72,
      emailDelivery: { status: "sent", sentAt: "2026-10-07T09:00:00.000Z" },
    });
    await invite();
    expect(await screen.findByText("Invitation sent")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("Emailed to dana@example.com");
    expect((screen.getByLabelText("Link") as HTMLInputElement).value).toBe(link);
  });

  it("asks the admin to send the link themselves when the email didn't go out", async () => {
    inviteMember.mockResolvedValue({
      message: "ok",
      inviteUrl: link,
      emailDelivery: { status: "failed", reason: "n8n_http_400" },
    });
    await invite();
    expect(await screen.findByText("Send this sign-up link")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain(
      "The email didn't send (the email service turned it down (n8n_http_400)). Copy the link and send it to dana@example.com yourself.",
    );
  });

  it("shows no email status when the API didn't report one", () => {
    render(<CopyLinkDialog open onOpenChange={() => {}} title="T" description="D" link={link} />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it.each([
    [{ status: "skipped", reason: "disabled" }, "email sending isn't set up"],
    [{ status: "failed", reason: "timeout" }, "the email service didn't answer in time"],
    [{ status: "failed", reason: "unavailable" }, "the email service isn't available right now"],
  ] as const)("explains %o", (delivery, text) => {
    expect(describeStaffEmailProblem(delivery)).toBe(text);
  });
});
