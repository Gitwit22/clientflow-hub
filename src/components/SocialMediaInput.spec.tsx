import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { invalidSocialLinks } from "@/lib/social-platforms";
import { RepeatableSocialLinksInput } from "./SocialMediaInput";

let latest: string[] = [];

function Harness({ initial = [] }: { initial?: string[] }) {
  const [links, setLinks] = useState<string[]>(initial);
  latest = links;
  return <RepeatableSocialLinksInput inputId="social-links" value={links} onChange={setLinks} />;
}

afterEach(() => {
  cleanup();
  latest = [];
});

describe("RepeatableSocialLinksInput", () => {
  it("starts with one row and preserves values while adding and removing links", () => {
    render(<Harness />);

    const firstInput = screen.getByRole("textbox");
    fireEvent.change(firstInput, { target: { value: "https://instagram.com/northstar" } });
    fireEvent.click(screen.getByRole("button", { name: "Add another" }));

    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(2);
    expect((inputs[0] as HTMLInputElement).value).toBe("https://instagram.com/northstar");

    fireEvent.change(inputs[1], { target: { value: "https://linkedin.com/company/northstar" } });
    fireEvent.click(screen.getByRole("button", { name: "Remove social media link 2" }));

    expect(screen.getAllByRole("textbox")).toHaveLength(1);
    expect(latest).toEqual(["https://instagram.com/northstar"]);
  });

  it("saves a handle as the chosen platform's profile link", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("combobox", { name: "Social media site 1" }), {
      target: { value: "tiktok" },
    });
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "@eabakery" } });
    expect(latest).toEqual(["https://tiktok.com/@eabakery"]);
  });

  it("picks the site from a pasted link and treats other sites as 'Other link'", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "facebook.com/EA.Bakery" } });
    expect(
      (screen.getByRole("combobox", { name: "Social media site 1" }) as HTMLSelectElement).value,
    ).toBe("facebook");
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "linktr.ee/eabakery" } });
    expect(latest).toEqual(["https://linktr.ee/eabakery"]);
  });

  it("asks for the site when a handle has none, and flags it for the form", () => {
    render(<Harness />);
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "@eabakery" } });
    expect(screen.getByText("Choose which site this is.")).toBeTruthy();
    expect(invalidSocialLinks(latest)).toEqual(["@eabakery"]);
  });

  it("shows stored links as site + handle", () => {
    render(<Harness initial={["https://instagram.com/eabakery", "https://eabakery.com/links"]} />);
    const selects = screen.getAllByRole("combobox") as HTMLSelectElement[];
    const inputs = screen.getAllByRole("textbox") as HTMLInputElement[];
    expect(selects.map((select) => select.value)).toEqual(["instagram", "other"]);
    expect(inputs.map((input) => input.value)).toEqual(["eabakery", "https://eabakery.com/links"]);
  });
});
