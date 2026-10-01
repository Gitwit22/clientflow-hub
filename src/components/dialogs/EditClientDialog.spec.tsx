import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Client } from "@/types";
import { EditClientDialog } from "./EditClientDialog";

const updateClient = vi.fn();

vi.mock("@/lib/api", () => ({
  updateClient: (...a: unknown[]) => updateClient(...a),
}));
vi.mock("@/hooks/use-organization-members", () => ({
  useOrganizationMembers: () => ({ activeMembers: [] }),
  memberName: () => "",
  memberOptionLabel: () => "",
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const client = {
  id: "c1",
  businessName: "EA Bakery",
  primaryContactName: "Erin",
  email: "erin@example.com",
  phone: "313-555-0100",
  status: "PROGRAM_SELECTED",
  assignedStaff: "",
  socialLinks: [],
  intake: {
    businessDescription: "Bakery",
    assistanceRequested: "Funding",
    programOfInterest: "Grant",
    budgetNeed: "",
    preferredContact: "Phone",
    heardAboutUs: "",
    additionalComments: "",
    uploadedFiles: ["plan.pdf"],
  },
} as unknown as Client;

beforeEach(() => updateClient.mockResolvedValue(client));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("EditClientDialog intake details", () => {
  it("shows the intake answers and sends only the changed ones", async () => {
    const onOpenChange = vi.fn();
    render(<EditClientDialog client={client} open onOpenChange={onOpenChange} />);

    const description = screen.getByLabelText("Brief business description") as HTMLTextAreaElement;
    expect(description.value).toBe("Bakery");
    fireEvent.change(description, { target: { value: "Bakery and cafe " } });
    fireEvent.change(screen.getByLabelText("Cell phone"), { target: { value: "313-555-0199" } });
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));

    await waitFor(() => expect(updateClient).toHaveBeenCalledTimes(1));
    expect(updateClient).toHaveBeenCalledWith("c1", {
      intake: { businessDescription: "Bakery and cafe", cellPhone: "313-555-0199" },
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("closes without saving when nothing changed", () => {
    const onOpenChange = vi.fn();
    render(<EditClientDialog client={client} open onOpenChange={onOpenChange} />);
    fireEvent.click(screen.getByRole("button", { name: "Save changes" }));
    expect(updateClient).not.toHaveBeenCalled();
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
