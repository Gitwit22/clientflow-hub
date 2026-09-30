import type { Communication, Contract } from "@/types";

/** Everything staff can send to a client from one place. */
export type SendKind = "intake" | "program_form" | "general_form" | "contract" | "welcome";

export const SEND_KINDS: readonly { kind: SendKind; label: string; hint: string }[] = [
  { kind: "intake", label: "Send / resend intake", hint: "The General Intake form" },
  { kind: "program_form", label: "Send program form", hint: "A form for the selected program" },
  { kind: "general_form", label: "Send general form", hint: "A form that isn't tied to a program" },
  { kind: "contract", label: "Send contract", hint: "The selected program's agreement" },
  { kind: "welcome", label: "Send / resend welcome email", hint: "After the contract is signed" },
] as const;

export const PROGRAM_REQUIRED_REASON =
  "Assign the client to a program before sending program-specific materials.";

export interface SendAvailability {
  enabled: boolean;
  /** Why it is disabled, shown to staff. */
  reason?: string;
}

/**
 * Program context comes only from the client's enrollment: with none, only the intake and general
 * forms can go out; everything program-specific is disabled with an explanation.
 */
export function sendAvailability(input: {
  hasEnrollment: boolean;
}): Record<SendKind, SendAvailability> {
  const programOnly: SendAvailability = input.hasEnrollment
    ? { enabled: true }
    : { enabled: false, reason: PROGRAM_REQUIRED_REASON };
  return {
    intake: { enabled: true },
    general_form: { enabled: true },
    program_form: programOnly,
    contract: programOnly,
    welcome: programOnly,
  };
}

export type ContractSendState =
  | { kind: "none" }
  | { kind: "draft"; contract: Contract }
  | { kind: "sent"; contract: Contract }
  | { kind: "opened"; contract: Contract }
  | { kind: "signed"; contract: Contract }
  | { kind: "closed"; contract: Contract };

/** The contract a client is currently working through for an enrollment (newest first). */
export function currentContract(
  contracts: readonly Contract[],
  enrollmentId: string | undefined,
): Contract | undefined {
  return [...contracts]
    .filter(
      (contract) =>
        !(contract.legacy && contract.status !== "COMPLETED") &&
        (!contract.enrollmentId || !enrollmentId || contract.enrollmentId === enrollmentId),
    )
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
}

/**
 * DRAFT → send; SENT/OPENED → resend the signing link; COMPLETED → send an executed copy (never the
 * signing link). CANCELLED/EXPIRED are closed: a new contract has to be drafted.
 */
export function contractSendState(contract: Contract | undefined): ContractSendState {
  if (!contract) return { kind: "none" };
  switch (contract.status) {
    case "DRAFT":
      return { kind: "draft", contract };
    case "SENT":
      return { kind: "sent", contract };
    case "OPENED":
      return { kind: "opened", contract };
    case "COMPLETED":
      return { kind: "signed", contract };
    default:
      return { kind: "closed", contract };
  }
}

export type WelcomeSendState =
  | { kind: "blocked"; reason: string }
  | { kind: "ready" }
  | { kind: "sent"; sentAt: string | null }
  | { kind: "failed"; errorCode: string | null };

/**
 * The welcome email keeps the workflow's signature gate: nothing can be sent before the contract is
 * COMPLETED. Afterwards the newest welcome communication tells staff whether it went out.
 */
export function welcomeSendState(
  contract: Contract | undefined,
  communications: readonly Communication[],
): WelcomeSendState {
  if (!contract || contract.status !== "COMPLETED") {
    return {
      kind: "blocked",
      reason: "The contract must be signed before the welcome email can be sent.",
    };
  }
  const attempts = communications
    .filter(
      (communication) =>
        communication.type === "welcome_email" && communication.contractId === contract.id,
    )
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date));
  const sent = attempts.find((communication) => communication.status === "SENT");
  if (sent) return { kind: "sent", sentAt: sent.sentAt ?? sent.date ?? null };
  const latest = attempts[0];
  if (latest?.status === "FAILED") return { kind: "failed", errorCode: latest.errorCode ?? null };
  return { kind: "ready" };
}

/** One key per send attempt (see the API client): reused on a retry, fresh for a deliberate resend. */
export function newIdempotencyKey(): string {
  const cryptoApi = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `attempt-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * A delivery failure reason → words staff can act on. `n8n_http_NNN` means n8n answered with that
 * HTTP status instead of sending (for example, a 500 when the n8n plan has ended).
 */
export function describeDeliveryReason(reason: string): string {
  const httpStatus = /^n8n_http_(\d{3})$/.exec(reason)?.[1];
  if (!httpStatus) return reason.replace(/_/g, " ");
  if (httpStatus === "401" || httpStatus === "403") {
    return `n8n refused ClientFlow's credentials, HTTP ${httpStatus}`;
  }
  if (httpStatus === "404") return "the n8n email workflow is not active, HTTP 404";
  return `n8n could not run the email workflow, HTTP ${httpStatus}; check the n8n account and plan`;
}

/** A delivery result → the message staff should see. Anything but `sent` is a failure to surface. */
export function describeDelivery(delivery: { status: string; reason?: string }): {
  ok: boolean;
  message: string;
} {
  if (delivery.status === "sent") return { ok: true, message: "Sent." };
  if (delivery.status === "pending") {
    return {
      ok: false,
      message: "This send is still in progress. Check the Communications tab shortly.",
    };
  }
  const reason = delivery.reason ? ` (${describeDeliveryReason(delivery.reason)})` : "";
  return { ok: false, message: `The email was not sent${reason}.` };
}

/**
 * True when the server answered with a failure (an ApiError carries an HTTP status). The attempt is
 * over, so the next click gets a new key. False for a dropped connection, where the request may
 * still have been processed: the same key is reused so a retry cannot send twice.
 */
export function isDefinitiveFailure(error: unknown): boolean {
  return typeof (error as { status?: unknown } | null)?.status === "number";
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Why an email can't go to this client yet (same rule the server applies), or null. Shown in the
 * send dialogs so staff fix the profile instead of discovering a failed delivery.
 */
export function recipientProblem(client: {
  email?: string | null;
  primaryContactName?: string | null;
}): string | null {
  const email = client.email?.trim() ?? "";
  if (!email) return "This client has no email address. Add one with Edit client before sending.";
  if (!EMAIL_PATTERN.test(email))
    return `"${email}" is not a valid email address. Correct it with Edit client before sending.`;
  if (!client.primaryContactName?.trim())
    return "This client has no contact name. Add one with Edit client before sending.";
  return null;
}
