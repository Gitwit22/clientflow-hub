import { describe, expect, it } from "vitest";
import { detectPlatform, handleForInput, OTHER_PLATFORM, socialUrl } from "./social-platforms";

describe("socialUrl", () => {
  it("turns a handle into the platform's profile address", () => {
    expect(socialUrl("instagram", "@eabakery")).toBe("https://instagram.com/eabakery");
    expect(socialUrl("instagram", "eabakery")).toBe("https://instagram.com/eabakery");
    expect(socialUrl("tiktok", "@ea.bakery")).toBe("https://tiktok.com/@ea.bakery");
    expect(socialUrl("youtube", "EABakery")).toBe("https://youtube.com/@EABakery");
    expect(socialUrl("x", "@eabakery")).toBe("https://x.com/eabakery");
    expect(socialUrl("linkedin", "pat-baker")).toBe("https://linkedin.com/in/pat-baker");
    expect(socialUrl("instagram", "ea.bakery")).toBe("https://instagram.com/ea.bakery");
    expect(socialUrl("instagram", "instagram.com")).toBe("https://instagram.com/");
  });

  it("keeps a pasted link, adding https:// when missing", () => {
    expect(socialUrl("instagram", "instagram.com/eabakery")).toBe("https://instagram.com/eabakery");
    expect(socialUrl("linkedin", "https://www.linkedin.com/company/ea-bakery")).toBe(
      "https://www.linkedin.com/company/ea-bakery",
    );
    expect(socialUrl(OTHER_PLATFORM, "linktr.ee/eabakery")).toBe("https://linktr.ee/eabakery");
  });

  it("refuses what can't become a working link", () => {
    expect(socialUrl("instagram", "")).toBeNull();
    expect(socialUrl("instagram", "my bakery page")).toBeNull();
    expect(socialUrl(OTHER_PLATFORM, "@eabakery")).toBeNull();
    expect(socialUrl("", "@eabakery")).toBeNull();
    expect(socialUrl("instagram", "javascript:alert(1)")).toBeNull();
  });
});

describe("detectPlatform / handleForInput", () => {
  it("recognises platforms from the address", () => {
    expect(detectPlatform("https://m.facebook.com/EA.Bakery")?.id).toBe("facebook");
    expect(detectPlatform("twitter.com/eabakery")?.id).toBe("x");
    expect(detectPlatform("https://eabakery.com")).toBeUndefined();
    expect(detectPlatform("@eabakery")).toBeUndefined();
  });

  it("shows the handle for a stored profile link, else the link itself", () => {
    expect(handleForInput("instagram", "https://instagram.com/eabakery")).toBe("eabakery");
    expect(handleForInput("tiktok", "https://www.tiktok.com/@eabakery")).toBe("eabakery");
    expect(handleForInput("linkedin", "https://linkedin.com/company/ea")).toBe(
      "https://linkedin.com/company/ea",
    );
  });
});
