import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { RepeatableSocialLinksInput } from "./SocialMediaInput";

function Harness() {
  const [links, setLinks] = useState<string[]>([]);
  return (
    <RepeatableSocialLinksInput
      inputId="social-links"
      value={links}
      onChange={setLinks}
    />
  );
}

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
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "https://instagram.com/northstar",
    );
  });
});
