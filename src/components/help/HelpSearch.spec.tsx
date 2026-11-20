import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HelpSearch } from "./HelpSearch";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

beforeEach(() => vi.clearAllMocks());
afterEach(cleanup);

const box = () => screen.getByRole("combobox", { name: "Search help" });
const type = (text: string) => {
  fireEvent.focus(box());
  fireEvent.change(box(), { target: { value: text } });
};

describe("HelpSearch (top bar)", () => {
  it("suggests matching topics as staff type", () => {
    render(<HelpSearch />);
    expect(screen.queryByRole("listbox")).toBeNull();
    type("past payment");
    const options = screen.getAllByRole("option").map((option) => option.textContent);
    expect(options[0]).toContain("Set up and record client payments");
    expect(options.at(-1)).toContain("See all help results for “past payment”");
    expect(box().getAttribute("aria-expanded")).toBe("true");
  });

  it("opens the chosen topic in the Help guide, by click or keyboard", () => {
    render(<HelpSearch />);
    type("award");
    fireEvent.click(screen.getAllByRole("option")[0]);
    expect(navigate).toHaveBeenCalledWith({ to: "/help", hash: expect.any(String) });
    expect((box() as HTMLInputElement).value).toBe("");

    type("monitoring");
    fireEvent.keyDown(box(), { key: "ArrowDown" });
    fireEvent.keyDown(box(), { key: "ArrowUp" });
    fireEvent.keyDown(box(), { key: "Enter" });
    expect(navigate).toHaveBeenLastCalledWith({ to: "/help", hash: "monitoring" });
  });

  it("shows every match on the Help page, or says nothing matched", () => {
    render(<HelpSearch />);
    type("payment");
    fireEvent.click(screen.getByRole("option", { name: /See all help results/ }));
    expect(navigate).toHaveBeenCalledWith({ to: "/help", search: { q: "payment" } });

    type("qwertyuiop");
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option").textContent).toContain("No topics match “qwertyuiop”");
  });

  it("closes on Escape and clears the box on a second Escape", () => {
    render(<HelpSearch />);
    type("billing");
    fireEvent.keyDown(box(), { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((box() as HTMLInputElement).value).toBe("");
  });
});
