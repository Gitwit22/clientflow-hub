import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PROGRAM_REQUIRED_REASON } from "@/lib/client-send";
import { ClientSendMenu, SendToClientPanel } from "./ClientSendMenu";

afterEach(cleanup);

function openMenu() {
  fireEvent.keyDown(screen.getByRole("button", { name: /Send/ }), { key: "Enter" });
}
const item = (name: RegExp) => screen.getByRole("menuitem", { name });
const disabled = (el: HTMLElement) =>
  el.getAttribute("aria-disabled") === "true" || el.hasAttribute("data-disabled");

describe("ClientSendMenu", () => {
  it("offers every send action in one menu", () => {
    render(<ClientSendMenu hasEnrollment onSelect={vi.fn()} />);
    openMenu();
    expect(screen.getAllByRole("menuitem")).toHaveLength(5);
    for (const label of [
      /Send \/ resend intake/,
      /Send program form/,
      /Send general form/,
      /Send contract/,
      /Send \/ resend welcome email/,
    ]) {
      expect(item(label)).toBeTruthy();
    }
  });

  it("zero enrollments: intake and general forms work, program-specific actions are disabled and explained", () => {
    const onSelect = vi.fn();
    render(<ClientSendMenu hasEnrollment={false} onSelect={onSelect} />);
    openMenu();

    expect(disabled(item(/Send \/ resend intake/))).toBe(false);
    expect(disabled(item(/Send general form/))).toBe(false);
    expect(disabled(item(/Send program form/))).toBe(true);
    expect(disabled(item(/Send contract/))).toBe(true);
    expect(disabled(item(/Send \/ resend welcome email/))).toBe(true);
    expect(screen.getByText(PROGRAM_REQUIRED_REASON)).toBeTruthy();

    fireEvent.click(item(/Send program form/));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("with an enrollment, every action is enabled and no restriction is shown", () => {
    render(<ClientSendMenu hasEnrollment onSelect={vi.fn()} />);
    openMenu();
    for (const entry of screen.getAllByRole("menuitem")) expect(disabled(entry)).toBe(false);
    expect(screen.queryByText(PROGRAM_REQUIRED_REASON)).toBeNull();
  });

  it("selecting an action reports which one", () => {
    const onSelect = vi.fn();
    render(<ClientSendMenu hasEnrollment onSelect={onSelect} />);
    openMenu();
    fireEvent.click(item(/Send contract/));
    expect(onSelect).toHaveBeenCalledWith("contract");
  });
});

describe("SendToClientPanel", () => {
  it("shows the four actions, with the same enrollment rules as the menu", () => {
    const onSelect = vi.fn();
    render(<SendToClientPanel hasEnrollment={false} onSelect={onSelect} />);

    const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;
    expect(button("General Form").disabled).toBe(false);
    for (const name of ["Program Form", "Contract", "Welcome Email"])
      expect(button(name).disabled).toBe(true);
    expect(screen.getByText(PROGRAM_REQUIRED_REASON)).toBeTruthy();

    fireEvent.click(button("General Form"));
    expect(onSelect).toHaveBeenCalledWith("general_form");
  });

  it("enables everything for a client with an enrollment", () => {
    const onSelect = vi.fn();
    render(<SendToClientPanel hasEnrollment onSelect={onSelect} />);
    for (const name of ["Program Form", "General Form", "Contract", "Welcome Email"]) {
      expect((screen.getByRole("button", { name }) as HTMLButtonElement).disabled).toBe(false);
    }
    fireEvent.click(screen.getByRole("button", { name: "Welcome Email" }));
    expect(onSelect).toHaveBeenCalledWith("welcome");
  });
});
