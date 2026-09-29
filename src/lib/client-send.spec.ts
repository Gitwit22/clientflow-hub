import { describe, expect, it } from "vitest";
import type { Communication, Contract } from "@/types";
import {
  PROGRAM_REQUIRED_REASON,
  SEND_KINDS,
  contractSendState,
  currentContract,
  describeDelivery,
  describeDeliveryReason,
  isDefinitiveFailure,
  newIdempotencyKey,
  sendAvailability,
  welcomeSendState,
} from "./client-send";

const contract = (overrides: Partial<Contract> = {}) =>
  ({
    id: "k1",
    clientId: "c1",
    enrollmentId: "e1",
    status: "DRAFT",
    contractType: "Agreement",
    createdAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  }) as Contract;

const communication = (overrides: Partial<Communication> = {}) =>
  ({
    id: "m1",
    clientId: "c1",
    type: "welcome_email",
    contractId: "k1",
    status: "SENT",
    date: "2026-09-02T00:00:00.000Z",
    sentAt: "2026-09-02T00:00:01.000Z",
    ...overrides,
  }) as Communication;

describe("sendAvailability", () => {
  it("with no enrollment, only the intake and general forms can be sent", () => {
    const availability = sendAvailability({ hasEnrollment: false });
    expect(availability.intake.enabled).toBe(true);
    expect(availability.general_form.enabled).toBe(true);
    for (const kind of ["program_form", "contract", "welcome"] as const) {
      expect(availability[kind]).toEqual({ enabled: false, reason: PROGRAM_REQUIRED_REASON });
    }
  });

  it("with an enrollment, everything is available", () => {
    const availability = sendAvailability({ hasEnrollment: true });
    for (const { kind } of SEND_KINDS) expect(availability[kind]).toEqual({ enabled: true });
  });

  it("explains the restriction in the words staff expect", () => {
    expect(PROGRAM_REQUIRED_REASON).toBe(
      "Assign the client to a program before sending program-specific materials.",
    );
  });
});

describe("currentContract / contractSendState", () => {
  it("picks the newest contract for the enrollment, ignoring other enrollments' contracts", () => {
    const list = [
      contract({ id: "old", createdAt: "2026-01-01T00:00:00.000Z" }),
      contract({ id: "new", createdAt: "2026-09-01T00:00:00.000Z" }),
      contract({ id: "other", enrollmentId: "e2", createdAt: "2026-10-01T00:00:00.000Z" }),
    ];
    expect(currentContract(list, "e1")?.id).toBe("new");
  });

  it("treats a contract with no enrollment as client-wide", () => {
    expect(currentContract([contract({ id: "wide", enrollmentId: null })], "e1")?.id).toBe("wide");
  });

  it.each([
    [undefined, "none"],
    ["DRAFT", "draft"],
    ["SENT", "sent"],
    ["OPENED", "opened"],
    ["COMPLETED", "signed"],
    ["CANCELLED", "closed"],
    ["EXPIRED", "closed"],
  ])("maps %s to %s", (status, kind) => {
    const state = contractSendState(status ? contract({ status }) : undefined);
    expect(state.kind).toBe(kind);
  });
});

describe("welcomeSendState", () => {
  it("is blocked until the contract is signed", () => {
    for (const status of ["DRAFT", "SENT", "OPENED"]) {
      expect(welcomeSendState(contract({ status }), [])).toEqual({
        kind: "blocked",
        reason: "The contract must be signed before the welcome email can be sent.",
      });
    }
    expect(welcomeSendState(undefined, []).kind).toBe("blocked");
  });

  it("is ready once signed and nothing has been sent", () => {
    expect(welcomeSendState(contract({ status: "COMPLETED" }), []).kind).toBe("ready");
  });

  it("reports a prior send (so the action becomes Resend), even if a later attempt failed", () => {
    const state = welcomeSendState(contract({ status: "COMPLETED" }), [
      communication({ id: "a", status: "SENT", date: "2026-09-02T00:00:00.000Z" }),
      communication({
        id: "b",
        status: "FAILED",
        date: "2026-09-03T00:00:00.000Z",
        errorCode: "timeout",
      }),
    ]);
    expect(state).toEqual({ kind: "sent", sentAt: "2026-09-02T00:00:01.000Z" });
  });

  it("reports a failed attempt when nothing has succeeded", () => {
    expect(
      welcomeSendState(contract({ status: "COMPLETED" }), [
        communication({ status: "FAILED", errorCode: "rejected" }),
      ]),
    ).toEqual({ kind: "failed", errorCode: "rejected" });
  });

  it("ignores other communication types and other contracts", () => {
    expect(
      welcomeSendState(contract({ status: "COMPLETED" }), [
        communication({ type: "contract_email" }),
        communication({ contractId: "someone-elses" }),
      ]).kind,
    ).toBe("ready");
  });
});

describe("delivery helpers", () => {
  it("describeDelivery only treats 'sent' as success", () => {
    expect(describeDelivery({ status: "sent" }).ok).toBe(true);
    expect(describeDelivery({ status: "failed", reason: "timeout" })).toEqual({
      ok: false,
      message: "The email was not sent (timeout).",
    });
    expect(describeDelivery({ status: "skipped", reason: "not_configured" }).message).toContain(
      "not configured",
    );
    expect(describeDelivery({ status: "pending" }).ok).toBe(false);
  });

  it("explains an n8n HTTP failure instead of showing the raw code", () => {
    expect(describeDelivery({ status: "failed", reason: "n8n_http_500" }).message).toBe(
      "The email was not sent (n8n could not run the email workflow, HTTP 500; check the n8n account and plan).",
    );
    expect(describeDeliveryReason("n8n_http_403")).toBe(
      "n8n refused ClientFlow's credentials, HTTP 403",
    );
    expect(describeDeliveryReason("n8n_http_404")).toBe(
      "the n8n email workflow is not active, HTTP 404",
    );
    expect(describeDeliveryReason("not_configured")).toBe("not configured");
  });

  it("isDefinitiveFailure is true only when the server answered", () => {
    expect(isDefinitiveFailure(Object.assign(new Error("x"), { status: 503 }))).toBe(true);
    expect(isDefinitiveFailure(new TypeError("Failed to fetch"))).toBe(false);
    expect(isDefinitiveFailure(null)).toBe(false);
  });

  it("newIdempotencyKey produces distinct keys the server will accept", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9._:-]{8,128}$/);
  });
});
