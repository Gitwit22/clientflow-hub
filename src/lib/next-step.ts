import { contractSendState, currentContract, welcomeSendState } from "@/lib/client-send";
import { isTerminalEnrollmentStatus } from "@/lib/enrollment-status";
import type { Communication, Contract } from "@/types";

export type NextStep =
  /** No contract yet, or the last one was cancelled/expired (e.g. an old placeholder draft). */
  | { kind: "send_contract"; label: string; action: "contract"; button: string }
  /** Emailed and waiting for the client; resending issues a fresh signing link. */
  | { kind: "awaiting_signature"; label: string; action: "contract"; button: string }
  /** Signed; the welcome email hasn't gone out (or the last attempt failed). */
  | { kind: "send_welcome"; label: string; action: "welcome"; button: string }
  | { kind: "done"; label: string }
  | { kind: "closed"; label: string };

/**
 * The one thing that moves an enrollment forward: send the contract, resend its signing link, send
 * the welcome email, or nothing. Reads the same contract/welcome state the send dialogs use, so the
 * button always opens a dialog that can do what it says.
 */
export function nextStep(
  enrollment: { id: string; status: string; isArchived?: boolean },
  contracts: readonly Contract[],
  communications: readonly Communication[],
): NextStep {
  if (enrollment.isArchived || isTerminalEnrollmentStatus(enrollment.status)) {
    return { kind: "closed", label: "Closed" };
  }
  const contract = currentContract(contracts, enrollment.id);
  const state = contractSendState(contract);
  switch (state.kind) {
    case "none":
      return {
        kind: "send_contract",
        label: "Needs a contract",
        action: "contract",
        button: "Send contract",
      };
    case "closed":
      return {
        kind: "send_contract",
        label: "Previous contract closed",
        action: "contract",
        button: "Send new contract",
      };
    case "draft":
      return {
        kind: "send_contract",
        label: "Contract not sent yet",
        action: "contract",
        button: "Send contract",
      };
    case "sent":
    case "opened":
      return {
        kind: "awaiting_signature",
        label: state.kind === "opened" ? "Opened, not signed" : "Waiting for signature",
        action: "contract",
        button: "Resend link",
      };
    case "signed": {
      const welcome = welcomeSendState(contract, communications);
      if (welcome.kind === "sent") return { kind: "done", label: "Welcome email sent" };
      return {
        kind: "send_welcome",
        label: welcome.kind === "failed" ? "Welcome email failed" : "Signed, welcome not sent",
        action: "welcome",
        button: welcome.kind === "failed" ? "Retry welcome" : "Send welcome",
      };
    }
  }
}
