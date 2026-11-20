import type React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageHeader } from "@/components/PageHeader";
import { HelpCenter } from "./HelpCenter";

vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to, hash }: { children: React.ReactNode; to: string; hash?: string }) => (
    <a href={hash ? `${to}#${hash}` : to}>{children}</a>
  ),
  // The router's address follows window.location in these tests.
  useRouterState: ({ select }: { select: (state: { location: { hash: string } }) => unknown }) =>
    select({ location: { hash: window.location.hash.slice(1) } }),
}));

beforeEach(() => {
  window.history.replaceState(null, "", "/help");
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe("HelpCenter", () => {
  it("lists topics by area, with links to the page where the task is done", () => {
    render(<HelpCenter />);
    expect(screen.getByRole("region", { name: "Funding awards" })).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Award a grant and send the funding agreement" }),
    ).toBeTruthy();
    expect(screen.getAllByRole("link", { name: /Go to Payments/ })[0].getAttribute("href")).toBe(
      "/payments",
    );
  });

  it("filters topics as staff search, and says when nothing matches", () => {
    render(<HelpCenter />);
    fireEvent.change(screen.getByPlaceholderText("Filter topics…"), {
      target: { value: "past payment" },
    });
    expect(screen.getByRole("heading", { name: "Set up and record client payments" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Reports" })).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Filter topics…"), {
      target: { value: "qwertyuiop" },
    });
    expect(screen.getByRole("status").textContent).toContain(
      "No help topics match “qwertyuiop”. Try a shorter word.",
    );
  });

  it("starts filtered when opened from the top-bar search's See all results", () => {
    render(<HelpCenter initialQuery="ledger" />);
    expect((screen.getByPlaceholderText("Filter topics…") as HTMLInputElement).value).toBe(
      "ledger",
    );
    expect(screen.getByRole("heading", { name: "Set up and record client payments" })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Reports" })).toBeNull();
  });

  it("opens the topic named in the address and highlights it", async () => {
    window.history.replaceState(null, "", "/help#billing-setup");
    render(<HelpCenter />);
    const topic = document.getElementById("billing-setup")!;
    await waitFor(() => expect(topic.className).toContain("ring-2"));
    await waitFor(() => expect(topic.scrollIntoView).toHaveBeenCalled());
    expect(document.getElementById("reports")!.className).not.toContain("ring-2");
  });
});

describe("PageHeader help link", () => {
  it("links to the page's help topic only when one is given", () => {
    const { rerender } = render(<PageHeader title="Payments" helpTopic="payments-page" />);
    expect(screen.getByRole("link", { name: "How this works" }).getAttribute("href")).toBe(
      "/help#payments-page",
    );
    rerender(<PageHeader title="Payments" />);
    expect(screen.queryByRole("link", { name: "How this works" })).toBeNull();
  });
});
