import { describe, expect, it } from "vitest";
import { preferredContactLink } from "./preferred-contact";

const details = { phone: "(313) 555-0100", email: "pat@nxtlvl.tech" };

describe("preferredContactLink", () => {
  it("shows the number for phone, call or text, and the address for email", () => {
    expect(preferredContactLink("Phone", details)).toEqual({
      method: "Phone",
      value: "(313) 555-0100",
      href: "tel:3135550100",
    });
    expect(preferredContactLink("Phone call", details)?.href).toBe("tel:3135550100");
    expect(preferredContactLink("Text message", details)?.href).toBe("sms:3135550100");
    expect(preferredContactLink("Email", details)).toEqual({
      method: "Email",
      value: "pat@nxtlvl.tech",
      href: "mailto:pat@nxtlvl.tech",
    });
  });

  it("keeps other answers as given and falls back when the detail is missing", () => {
    expect(preferredContactLink("In person", details)).toEqual({ method: "In person" });
    expect(preferredContactLink("Phone", { email: "x@y.z" })).toEqual({ method: "Phone" });
    expect(preferredContactLink("", details)).toBeNull();
  });
});
