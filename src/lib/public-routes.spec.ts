import { describe, expect, it } from "vitest";
import { isPublicRoute } from "./public-routes";

describe("isPublicRoute", () => {
  it("keeps public intake and agreement links outside the authenticated shell", () => {
    expect(isPublicRoute("/login")).toBe(true);
    expect(isPublicRoute("/accept-invite/token")).toBe(true);
    expect(isPublicRoute("/s/intake-token")).toBe(true);
    expect(isPublicRoute("/agreements/contract-token")).toBe(true);
  });

  it("does not expose admin routes as public", () => {
    expect(isPublicRoute("/programs/prog-inspired-detroit")).toBe(false);
    expect(isPublicRoute("/agreements")).toBe(false);
    expect(isPublicRoute("/agreements-admin/contract-token")).toBe(false);
  });
});
