import { describe, expect, it } from "vitest";
import { resolveMemberName } from "./use-organization-members";
import type { OrgMember } from "@/types";

describe("resolveMemberName", () => {
  const members = [
    {
      id: "staff-1",
      email: "staff@example.com",
      firstName: "Erin",
      lastName: "Advisor",
    },
  ] as OrgMember[];

  it("prefers the current organization member name over a persisted fallback", () => {
    expect(resolveMemberName(members, "staff-1", "Aliciaan Monroe")).toBe("Erin Advisor");
  });

  it("uses the persisted fallback when the member is unavailable", () => {
    expect(resolveMemberName(members, "former-user", "Former Staff")).toBe("Former Staff");
  });
});