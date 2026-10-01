import { describe, expect, it } from "vitest";
import { preferredContactLink } from "./preferred-contact";

const details = { phone: "(313) 555-0100", email: "pat@nxtlvl.tech" };

describe("preferredContactLink", () => {
  it("shows the number for any phone choice, and the address for email", () => {
    expect(preferredContactLink("Phone", details)).toEqual({
      method: "Phone",
      value: "(313) 555-0100",
      href: "tel:3135550100",
    });
    expect(preferredContactLink("Work number", details)?.value).toBe("(313) 555-0100");
    expect(preferredContactLink("Cell number", details)?.value).toBe("(313) 555-0100");
    expect(preferredContactLink("Text message", details)?.href).toBe("sms:3135550100");
    expect(preferredContactLink("Email", details)).toEqual({
      method: "Email",
      value: "pat@nxtlvl.tech",
      href: "mailto:pat@nxtlvl.tech",
    });
  });

  it("picks the work or cell number the client gave for that choice", () => {
    const both = { ...details, workPhone: "313-555-0200", cellPhone: "313-555-0300" };
    expect(preferredContactLink("Work number", both)?.value).toBe("313-555-0200");
    expect(preferredContactLink("Cell phone", both)?.value).toBe("313-555-0300");
    expect(preferredContactLink("Text me", both)?.href).toBe("sms:3135550300");
    expect(preferredContactLink("Phone call", both)?.value).toBe("(313) 555-0100");
    // Only a cell on file: a work choice still shows a number rather than nothing.
    expect(preferredContactLink("Work number", { cellPhone: "313-555-0300" })?.value).toBe(
      "313-555-0300",
    );
  });

  it("falls back to whatever number is on file for older clients with one unlabelled phone", () => {
    const legacy = { phone: "313-555-0100" };
    for (const choice of ["Home number", "Work number", "Cell", "Text", "Call me", "Landline"]) {
      expect(preferredContactLink(choice, legacy)?.value).toBe("313-555-0100");
    }
  });

  it("keeps other answers as given and falls back when the detail is missing", () => {
    expect(preferredContactLink("In person", details)).toEqual({ method: "In person" });
    expect(preferredContactLink("Phone", { email: "x@y.z" })).toEqual({ method: "Phone" });
    expect(preferredContactLink("Email", { phone: "1" })).toEqual({ method: "Email" });
    expect(preferredContactLink("", details)).toBeNull();
  });
});
