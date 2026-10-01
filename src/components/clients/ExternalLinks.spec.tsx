import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ExternalLinks } from "./ExternalLinks";

afterEach(cleanup);

describe("ExternalLinks", () => {
  it("opens each web address in a new tab, adding https:// when the client left it off", () => {
    render(<ExternalLinks links={["instagram.com/eabakery", "https://www.eabakery.com"]} />);

    const instagram = screen.getByRole("link", { name: /Instagram · @eabakery/ });
    expect(instagram.getAttribute("href")).toBe("https://instagram.com/eabakery");
    expect(instagram.getAttribute("target")).toBe("_blank");
    expect(instagram.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByRole("link", { name: /^eabakery\.com/ }).getAttribute("href")).toBe(
      "https://www.eabakery.com/",
    );
  });

  it("shows handles and unsafe values as plain text, and a dash when empty", () => {
    const { container, rerender } = render(
      <ExternalLinks links={["@eabakery", "javascript:alert(1)"]} />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(container.textContent).toContain("@eabakery");

    rerender(<ExternalLinks links={[null, " "]} />);
    expect(container.textContent).toBe("—");
  });
});
