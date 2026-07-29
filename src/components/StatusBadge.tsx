import { cn } from "@/lib/utils";

type Tone = "neutral" | "info" | "success" | "warning" | "danger" | "primary";

const toneClass: Record<Tone, string> = {
  neutral: "bg-neutral-badge text-neutral-badge-foreground",
  info: "bg-info/12 text-info",
  success: "bg-success/14 text-success",
  warning: "bg-warning/20 text-warning-foreground",
  danger: "bg-destructive/12 text-destructive",
  primary: "bg-primary/12 text-primary",
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
  "Terms Proposed": "primary",
  "Contract Pending": "warning",
  Active: "success",
  Monitoring: "primary",
  Completed: "success",
  "Final Report Needed": "warning",
  "Pre-Archive": "neutral",
  Archived: "neutral",
  "Closed Early": "neutral",
  Defaulted: "danger",
  // form statuses
  Draft: "neutral",
  "Ready to Send": "info",
  Sent: "info",
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
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold whitespace-nowrap",
        toneClass[tone],
        className,
      )}
    >
      <span className="size-1.5 rounded-full bg-current opacity-70" />
      {status}
    </span>
  );
}