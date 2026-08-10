import { cn } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "primary" | "plum";

const toneClass: Record<Tone, string> = {
  neutral: "bg-gray-tint text-neutral-badge-foreground",
  info: "bg-teal-tint text-primary",
  success: "bg-green-tint text-success",
  warning: "bg-ochre-tint text-warning",
  danger: "bg-coral-tint text-destructive",
  primary: "bg-teal-tint text-primary",
  plum: "bg-plum-tint text-plum",
};

const map: Record<string, Tone> = {
  // client statuses
  "New Intake": "info",
  "Needs Review": "warning",
  "More Information Needed": "warning",
  Qualified: "primary",
  Declined: "danger",
  Waitlisted: "neutral",
  Approved: "success",
  "Terms Proposed": "plum",
  "Contract Pending": "plum",
  Active: "success",
  Monitoring: "warning",
  Completed: "success",
  "Final Report Needed": "warning",
  "Pre-Archive": "neutral",
  Archived: "neutral",
  "Closed Early": "neutral",
  Defaulted: "danger",
  // form assignment statuses (lowercase snake_case)
  draft: "neutral",
  sent: "info",
  delivered: "info",
  opened: "primary",
  in_progress: "primary",
  submitted: "success",
  under_review: "warning",
  approved: "success",
  cancelled: "neutral",
  expired: "danger",
  // relationship types
  prospect: "info",
  applicant: "warning",
  client: "success",
  sponsor: "primary",
  // lifecycle statuses
  new: "info",
  contacted: "info",
  intake_pending: "warning",
  qualified: "primary",
  active: "success",
  not_a_fit: "neutral",
  declined: "danger",
  inactive: "neutral",
  archived: "neutral",
  // legacy form statuses (kept for backward compat)
  Draft: "neutral",
  "Ready to Send": "info",
  Sent: "plum",
  Opened: "primary",
  "In Progress": "primary",
  Submitted: "success",
  "Needs Correction": "warning",
  Rejected: "danger",
  Expired: "danger",
  Cancelled: "neutral",
  // contracts / monitoring
  "Internal Review": "warning",
  Signed: "success",
  Due: "warning",
  Overdue: "danger",
  Scheduled: "info",
  Pending: "warning",
};

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const tone = map[status] ?? "neutral";
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 font-mono text-[9.5px] font-medium uppercase tracking-wide",
        toneClass[tone],
        className,
      )}
    >
      {status}
    </span>
  );
}
