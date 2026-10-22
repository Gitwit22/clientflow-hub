/** Program-wide emails: one message sent separately to every member of a program. */

export type RecipientOutcome = "pending" | "sending" | "accepted" | "failed";
export type SkipReason = "missing_email" | "invalid_email" | "duplicate_email";

export interface ProgramEmailRecipientPreview {
  clientId: string;
  enrollmentId: string;
  businessName: string;
  name: string;
  email: string;
}

export interface SkippedMember {
  clientId: string;
  businessName: string;
  email: string | null;
  reason: SkipReason;
}

export interface ProgramEmailRecipientsPreview {
  program: { id: string; name: string };
  recipients: ProgramEmailRecipientPreview[];
  skipped: SkippedMember[];
  recipientCount: number;
  skippedCount: number;
}

export interface ProgramEmailCounts {
  pending: number;
  sending: number;
  accepted: number;
  failed: number;
}

export interface ProgramEmailSummary {
  id: string;
  programId: string;
  subject: string;
  body: string;
  sentByDisplayName: string;
  /** SENDING while any recipient waits or is being sent; COMPLETED once each has an outcome. */
  status: "SENDING" | "COMPLETED" | string;
  createdAt: string;
  completedAt: string | null;
  recipientCount: number;
  skippedCount: number;
  counts: ProgramEmailCounts;
}

export interface ProgramEmailDetail extends ProgramEmailSummary {
  recipients: {
    communicationId: string;
    clientId: string;
    name: string;
    businessName: string;
    email: string;
    outcome: RecipientOutcome;
    errorCode: string | null;
    acceptedAt: string | null;
  }[];
  skipped: SkippedMember[];
}

export const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  missing_email: "No email address",
  invalid_email: "Email address isn't valid",
  duplicate_email: "Same address as another member (sent once)",
};

/** "Accepted" means the email provider took it; ClientFlow never claims it reached the inbox. */
export const OUTCOME_LABELS: Record<RecipientOutcome, string> = {
  pending: "Waiting",
  sending: "Sending",
  accepted: "Accepted by email provider",
  failed: "Failed",
};

export const isStillSending = (email: Pick<ProgramEmailSummary, "status" | "counts">) =>
  email.status === "SENDING" || email.counts.pending + email.counts.sending > 0;

/** "3 accepted · 1 failed · 2 waiting · 2 skipped" — only the parts that apply. */
export function outcomeSummary(
  email: Pick<ProgramEmailSummary, "counts" | "skippedCount">,
): string {
  const { accepted, failed, pending, sending } = email.counts;
  const parts = [`${accepted} accepted`];
  if (failed) parts.push(`${failed} failed`);
  if (pending + sending) parts.push(`${pending + sending} waiting`);
  if (email.skippedCount) parts.push(`${email.skippedCount} skipped`);
  return parts.join(" · ");
}

/** Plain words for a recorded failure code. */
export function failureReason(code: string | null): string {
  if (!code) return "Unknown error";
  if (code === "not_configured" || code === "disabled") return "Email sending isn't set up";
  if (code === "timeout") return "The email service didn't answer in time";
  if (code.startsWith("n8n_http_4")) return `The email service turned it down (${code})`;
  if (code.startsWith("n8n_http_5")) return `The email service had an error (${code})`;
  return "The email service wasn't available";
}
