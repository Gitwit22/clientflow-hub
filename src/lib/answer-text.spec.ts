import { describe, expect, it } from "vitest";
import { toText } from "./answer-text";

describe("toText", () => {
  it("renders null and undefined as empty", () => {
    expect(toText(null)).toBe("");
    expect(toText(undefined)).toBe("");
  });

  it("trims strings", () => {
    expect(toText("  hello ")).toBe("hello");
  });

  it("renders numbers and booleans", () => {
    expect(toText(42)).toBe("42");
    expect(toText(0)).toBe("0");
    expect(toText(Number.NaN)).toBe("");
    expect(toText(true)).toBe("Yes");
    expect(toText(false)).toBe("No");
  });

  it("joins arrays, dropping blanks, recursively", () => {
    expect(toText(["a", " ", null, 2, ["b", "c"]])).toBe("a, 2, b, c");
  });

  it("renders objects as key: value pairs instead of [object Object]", () => {
    expect(toText({ instagram: "@x", facebook: "fb.com/x", tiktok: "" })).toBe(
      "instagram: @x, facebook: fb.com/x",
    );
    expect(toText({ nested: { a: 1 } })).toBe("nested: a: 1");
    expect(toText({})).toBe("");
  });

  it("never throws, whatever the stored answer looks like", () => {
    for (const value of [Symbol.iterator, () => 1, new Date(0), [undefined], { a: undefined }]) {
      expect(() => toText(value)).not.toThrow();
    }
  });
});
