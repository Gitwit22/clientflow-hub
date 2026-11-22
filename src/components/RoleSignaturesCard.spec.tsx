import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { RoleSignaturesCard } from "./RoleSignaturesCard";

vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("RoleSignaturesCard", () => {
  it("saves the Admin and Staff sign-offs, empty meaning none", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<RoleSignaturesCard value={{ org_admin: null, reviewer: "Old" }} onSave={onSave} />);
    const save = screen.getByRole("button", { name: "Save role signatures" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Admin signature"), {
      target: { value: "  Thank you,\nEAM Administration  " },
    });
    fireEvent.change(screen.getByLabelText("Staff signature"), { target: { value: "  " } });
    fireEvent.click(save);

    await waitFor(() =>
      expect(onSave).toHaveBeenCalledWith({
        org_admin: "Thank you,\nEAM Administration",
        reviewer: null,
      }),
    );
  });
});
