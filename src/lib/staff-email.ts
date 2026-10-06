import type { StaffEmailDelivery } from "@/lib/apiClient";

/** Why a staff email didn't go out, in words an admin can act on. */
export function describeStaffEmailProblem(delivery: StaffEmailDelivery): string {
  if (delivery.status === "sent") return "";
  const reason = delivery.reason;
  if (reason === "disabled" || reason === "not_configured") return "email sending isn't set up";
  if (reason === "timeout") return "the email service didn't answer in time";
  if (reason.startsWith("n8n_http_4")) return `the email service turned it down (${reason})`;
  if (reason === "rejected") return "the email service turned it down";
  return "the email service isn't available right now";
}
