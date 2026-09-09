import { beforeEach, describe, expect, it } from "vitest";
import { clearPublicFormIdempotencyKey, getPublicFormIdempotencyKey } from "./public-form-session";

describe("public form submission session", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("reuses one idempotency key for the same form token", () => {
    const first = getPublicFormIdempotencyKey("token-1");
    const second = getPublicFormIdempotencyKey("token-1");

    expect(second).toBe(first);
    expect(getPublicFormIdempotencyKey("token-2")).not.toBe(first);
  });

  it("clears only the key that completed successfully", () => {
    const key = getPublicFormIdempotencyKey("token-1");

    clearPublicFormIdempotencyKey("token-1", "different-key");
    expect(getPublicFormIdempotencyKey("token-1")).toBe(key);

    clearPublicFormIdempotencyKey("token-1", key);
    expect(getPublicFormIdempotencyKey("token-1")).not.toBe(key);
  });
});
