import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EmailStyleCard } from "./EmailStyleCard";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EmailStyleCard", () => {
  it("saves a trimmed signature and keeps the chosen layout", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EmailStyleCard
        title="Email signature & layout"
        description="For every email."
        value={{ emailSignature: null, emailLayout: "left" }}
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText("Email layout").textContent).toContain("Left, with a margin");
    fireEvent.change(screen.getByLabelText("Signature"), {
      target: { value: "  Warm regards,\nEA Management Team  " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save email settings" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        emailSignature: "Warm regards,\nEA Management Team",
        emailLayout: "left",
      }),
    );
  });

  it("on a program, empty means the organization's signature and layout", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(
      <EmailStyleCard
        forProgram
        title="For this program"
        description="Replaces the organization's."
        value={{ emailSignature: "The Grant Team", emailLayout: null }}
        onSave={onSave}
      />,
    );
    expect(screen.getByLabelText("Email layout").textContent).toContain("Same as the organization");
    fireEvent.change(screen.getByLabelText("Signature"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Save email settings" }));
    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({ emailSignature: null, emailLayout: null }),
    );
  });
});
