import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "@/lib/apiClient";

vi.mock("@tanstack/react-router", () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    options,
    useParams: () => ({ token: "tok-1" }),
  }),
}));

const getContract = vi.fn();
const acceptContract = vi.fn();
vi.mock("@/lib/apiClient", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  acfGetPublicContract: (...args: unknown[]) => getContract(...args),
  acfAcceptPublicContract: (...args: unknown[]) => acceptContract(...args),
}));

const { Route } = await import("./agreements.$token");
const Page = (Route as unknown as { options: { component: ComponentType } }).options.component;

const contract = {
  contract: {
    id: "c1",
    status: "SENT",
    contractName: "Membership Agreement",
    content: "# Terms\n\nThe **Client** agrees.\n\n" + "Clause.\n".repeat(60),
    expiresAt: null,
    purpose: "enrollment",
  },
  client: { name: "Pat" },
  program: { id: "p1", name: "Inspired Detroit" },
  headerImageUrl: null,
};

const box = () => screen.getByLabelText("Agreement text");
const signButton = () => screen.getByRole("button", { name: /sign/i }) as HTMLButtonElement;

function scrollBoxTo(position: number) {
  const element = box();
  Object.defineProperty(element, "scrollHeight", { configurable: true, value: 2000 });
  Object.defineProperty(element, "clientHeight", { configurable: true, value: 500 });
  Object.defineProperty(element, "scrollTop", { configurable: true, value: position });
  fireEvent.scroll(element);
}

async function readyAndUnlocked() {
  render(<Page />);
  await screen.findByRole("heading", { name: "Membership Agreement" });
  fireEvent.click(screen.getByRole("button", { name: "Jump to the end" }));
}

function fillValid() {
  fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Pat Owner" } });
  fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "pat@example.com" } });
  fireEvent.click(screen.getByRole("checkbox"));
}

beforeEach(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
  getContract.mockResolvedValue(contract);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("public agreement signing", () => {
  it("shows the agreement formatted and large, and can't be signed until the end is reached", async () => {
    render(<Page />);
    expect(await screen.findByRole("heading", { level: 2, name: "Terms" })).toBeTruthy();
    expect(box().className).toContain("md:text-[17px]");
    expect(signButton().textContent).toBe("Scroll to the end to sign");
    expect(signButton().disabled).toBe(true);
    expect((screen.getByRole("checkbox") as HTMLButtonElement).disabled).toBe(true);

    scrollBoxTo(800); // halfway: still locked
    expect(signButton().disabled).toBe(true);
    scrollBoxTo(1500); // the end
    expect(screen.getByText("You've reached the end of the agreement.")).toBeTruthy();
    expect(signButton().textContent).toBe("Sign agreement");
    expect(signButton().disabled).toBe(false);
  });

  it("unlocks right away when the whole agreement fits on screen", async () => {
    const scrollHeight = vi
      .spyOn(HTMLElement.prototype, "scrollHeight", "get")
      .mockReturnValue(200);
    const clientHeight = vi
      .spyOn(HTMLElement.prototype, "clientHeight", "get")
      .mockReturnValue(600);
    render(<Page />);
    await screen.findByRole("heading", { name: "Membership Agreement" });
    await waitFor(() => expect(signButton().disabled).toBe(false));
    scrollHeight.mockRestore();
    clientHeight.mockRestore();
  });

  it("says exactly what to fix next to each field, and clears it once fixed", async () => {
    await readyAndUnlocked();
    fireEvent.change(screen.getByLabelText(/^Email/), { target: { value: "pat@example" } });
    fireEvent.click(signButton());

    expect(screen.getByRole("alert").textContent).toBe(
      "Please fix the items marked below, then sign again.",
    );
    expect(screen.getByText("Type your full name — it's your signature.")).toBeTruthy();
    expect(screen.getByText("Enter a valid email address, like name@example.com.")).toBeTruthy();
    expect(screen.getByText("Tick the box to confirm you've read and agree.")).toBeTruthy();
    expect(screen.getByLabelText(/Full name/).getAttribute("aria-invalid")).toBe("true");
    expect(document.activeElement).toBe(screen.getByLabelText(/Full name/));
    expect(acceptContract).not.toHaveBeenCalled();

    fireEvent.change(screen.getByLabelText(/Full name/), { target: { value: "Pat Owner" } });
    expect(screen.queryByText("Type your full name — it's your signature.")).toBeNull();
  });

  it("signs once with the details as typed", async () => {
    acceptContract.mockResolvedValue({ contract: { id: "c1" } });
    await readyAndUnlocked();
    fillValid();
    fireEvent.click(signButton());
    fireEvent.click(signButton());
    expect(await screen.findByText("Agreement signed!")).toBeTruthy();
    expect(acceptContract).toHaveBeenCalledTimes(1);
    expect(acceptContract).toHaveBeenCalledWith("tok-1", {
      signedName: "Pat Owner",
      signedEmail: "pat@example.com",
      agreedToTerms: true,
      signatureNote: undefined,
    });
  });

  it("explains a link that stopped working while the page was open", async () => {
    acceptContract.mockRejectedValue(
      new ApiError(404, "NOT_FOUND", "The contract link is invalid or unavailable."),
    );
    await readyAndUnlocked();
    fillValid();
    fireEvent.click(signButton());
    expect(await screen.findByText("This signing link is no longer available")).toBeTruthy();
    expect(screen.getByText(/contact the Inspired Detroit team for a new link/)).toBeTruthy();
  });

  it("keeps what was typed and explains a lost connection", async () => {
    acceptContract.mockRejectedValue(new TypeError("Failed to fetch"));
    await readyAndUnlocked();
    fillValid();
    fireEvent.click(signButton());
    expect((await screen.findByRole("alert")).textContent).toMatch(/couldn't reach the server/);
    expect((screen.getByLabelText(/Full name/) as HTMLInputElement).value).toBe("Pat Owner");
  });

  it("puts a server validation message next to the right field", async () => {
    acceptContract.mockRejectedValue(
      new ApiError(400, "BAD_REQUEST", "signedEmail must be an email"),
    );
    await readyAndUnlocked();
    fillValid();
    fireEvent.click(signButton());
    expect(
      await screen.findByText("Enter a valid email address, like name@example.com."),
    ).toBeTruthy();
  });
});
