import { describe, expect, it } from "vitest";
import { currentLineSize, setLineSize, toggleCenter } from "./agreement-editing";

const at = (value: string, start = 0, end = start) => ({
  value,
  selectionStart: start,
  selectionEnd: end,
});

describe("agreement editing", () => {
  it("sets and changes the size of the current line, and back to normal", () => {
    expect(setLineSize(at("Payment terms", 3), "heading").value).toBe("# Payment terms");
    expect(setLineSize(at("# Payment terms", 3), "subheading").value).toBe("## Payment terms");
    expect(setLineSize(at("## Payment terms", 3), "small").value).toBe("-# Payment terms");
    expect(setLineSize(at("-# Payment terms", 3), "normal").value).toBe("Payment terms");
    // A list item that becomes a heading drops its marker.
    expect(setLineSize(at("- Terms", 3), "heading").value).toBe("# Terms");
  });

  it("sizes every selected line, leaving blank lines alone", () => {
    const value = "One\n\nTwo";
    expect(setLineSize(at(value, 0, value.length), "subheading").value).toBe("## One\n\n## Two");
  });

  it("reports the size of the line the caret is on", () => {
    expect(currentLineSize(at("Intro\n## Terms", 8))).toBe("subheading");
    expect(currentLineSize(at("Intro\n## Terms", 2))).toBe("normal");
  });

  it("centers a line (keeping its size) and un-centers it again", () => {
    const centered = toggleCenter(at("# Grant Agreement", 4));
    expect(centered.value).toBe("# ->Grant Agreement<-");
    expect(toggleCenter(at(centered.value, 4)).value).toBe("# Grant Agreement");
  });
});
