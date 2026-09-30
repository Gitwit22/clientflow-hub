import { describe, expect, it } from "vitest";
import { nextStep } from "./next-step";
import type { Communication, Contract } from "@/types";

const enrollment = { id: "e1", status: "interested" };
const contract = (overrides: Partial<Contract>) =>
  ({
    id: "k1",
    clientId: "c1",
    programId: "p1",
    enrollmentId: "e1",
    contractType: "Agreement",
    status: "DRAFT",
    createdAt: "2026-09-01T00:00:00.000Z",
    generatedContent: "",
    ...overrides,
  }) as Contract;
const welcome = (status: string) =>
  ({
    id: "w",
    clientId: "c1",
    contractId: "k1",
    type: "welcome_email",
    status,
    date: "2026-09-02T00:00:00.000Z",
  }) as Communication;

describe("nextStep", () => {
  it("asks for a contract after intake when there is none", () => {
    expect(nextStep(enrollment, [], [])).toMatchObject({
      kind: "send_contract",
      action: "contract",
    });
  });

  it("treats an old placeholder draft as no contract", () => {
    expect(nextStep(enrollment, [contract({ legacy: true })], [])).toMatchObject({
      kind: "send_contract",
      label: "Needs a contract",
    });
  });

  it("offers a fresh contract when the last one was cancelled (e.g. a bad link)", () => {
    expect(nextStep(enrollment, [contract({ status: "CANCELLED" })], [])).toMatchObject({
      kind: "send_contract",
      button: "Send new contract",
    });
  });

  it("offers to resend the signing link while waiting", () => {
    expect(nextStep(enrollment, [contract({ status: "SENT" })], [])).toMatchObject({
      kind: "awaiting_signature",
      button: "Resend link",
    });
  });

  it("moves a signed contract on to the welcome email, then done", () => {
    const signed = [contract({ status: "COMPLETED" })];
    expect(nextStep(enrollment, signed, [])).toMatchObject({
      kind: "send_welcome",
      action: "welcome",
    });
    expect(nextStep(enrollment, signed, [welcome("FAILED")])).toMatchObject({
      button: "Retry welcome",
    });
    expect(nextStep(enrollment, signed, [welcome("SENT")])).toMatchObject({ kind: "done" });
  });

  it("ignores contracts of the client's other enrollments", () => {
    expect(
      nextStep(enrollment, [contract({ enrollmentId: "other", status: "COMPLETED" })], []),
    ).toMatchObject({
      kind: "send_contract",
    });
  });

  it("does nothing for a closed enrollment", () => {
    expect(nextStep({ id: "e1", status: "withdrawn" }, [], [])).toMatchObject({ kind: "closed" });
  });
});
