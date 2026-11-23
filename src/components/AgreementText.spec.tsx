import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { AgreementText } from "./AgreementText";

afterEach(cleanup);

describe("AgreementText", () => {
  it("shows headings, styles, lists and centering, with no markup left", () => {
    const { container } = render(
      <AgreementText
        text={[
          "# ->Grant Agreement<-",
          "## Payment terms",
          "Pay **within _30_ days** or ++notify us++.",
          "- Attend meetings",
          "- Keep records",
          "1. Submit reports",
          "-# Fees are non-refundable.",
          "<script>alert(1)</script>",
        ].join("\n")}
      />,
    );
    const title = screen.getByRole("heading", { level: 2, name: "Grant Agreement" });
    expect(title.className).toContain("text-center");
    expect(screen.getByRole("heading", { level: 3, name: "Payment terms" })).toBeTruthy();
    const bold = Array.from(container.querySelectorAll("strong")).map((node) => node.textContent);
    expect(bold.join("")).toBe("within 30 days");
    expect(container.querySelector("strong em, em strong")?.textContent).toBe("30");
    expect(container.querySelector("u")?.textContent).toBe("notify us");
    expect(screen.getAllByRole("listitem").map((item) => item.textContent)).toEqual([
      "Attend meetings",
      "Keep records",
      "1.Submit reports",
    ]);
    expect(container.textContent).not.toMatch(/\*\*|\+\+|->|<-/);
    // Text is never interpreted as HTML.
    expect(container.querySelector("script")).toBeNull();
    expect(container.textContent).toContain("<script>alert(1)</script>");
  });
});
