import { describe, expect, it } from "vitest";
import { changedFields } from "./changed-fields";

describe("changedFields", () => {
  it("keeps only values that differ, comparing lists by content and null/undefined alike", () => {
    expect(
      changedFields(
        {
          status: "PROGRAM_SELECTED",
          phone: "313",
          socialLinks: ["a"],
          website: "",
          assignedUserId: null,
        },
        {
          status: "PROGRAM_SELECTED",
          phone: "",
          socialLinks: ["a"],
          website: "",
          assignedUserId: undefined,
        },
      ),
    ).toEqual({ phone: "313" });
  });
});
