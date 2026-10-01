import { describe, expect, it } from "vitest";
import { linkLabel, toExternalUrl } from "./external-links";

describe("toExternalUrl", () => {
  it("adds https:// to addresses typed without it", () => {
    expect(toExternalUrl("instagram.com/eabakery")).toBe("https://instagram.com/eabakery");
    expect(toExternalUrl(" www.eabakery.com ")).toBe("https://www.eabakery.com/");
    expect(toExternalUrl("https://www.facebook.com/EA.Bakery")).toBe(
      "https://www.facebook.com/EA.Bakery",
    );
  });

  it("refuses anything that is not a web address", () => {
    expect(toExternalUrl("javascript:alert(1)")).toBeNull();
    expect(toExternalUrl("data:text/html,hi")).toBeNull();
    expect(toExternalUrl("@eabakery")).toBeNull();
    expect(toExternalUrl("Eat at Joe's")).toBeNull();
    expect(toExternalUrl("")).toBeNull();
    expect(toExternalUrl(undefined)).toBeNull();
  });
});

describe("linkLabel", () => {
  it("names the platform and the handle", () => {
    expect(linkLabel("https://www.instagram.com/eabakery/")).toBe("Instagram · @eabakery");
    expect(linkLabel("https://tiktok.com/@eabakery")).toBe("TikTok · @eabakery");
    expect(linkLabel("https://x.com/eabakery")).toBe("X · @eabakery");
    expect(linkLabel("https://www.linkedin.com/company/ea-bakery")).toBe(
      "LinkedIn · company/ea-bakery",
    );
    expect(linkLabel("https://facebook.com/")).toBe("Facebook");
  });

  it("shows other sites without the scheme", () => {
    expect(linkLabel("https://www.eabakery.com/menu")).toBe("eabakery.com/menu");
  });
});
