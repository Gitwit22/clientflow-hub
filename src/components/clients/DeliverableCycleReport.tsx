import { Check } from "lucide-react";
import {
  isDoneStatus,
  type DeliverableCycle,
  type DeliverableSummary,
  type EnrollmentDeliverable,
  deliverableStatusLine,
} from "@/lib/program-deliverables";

/** A reporting period's delivery report, built only from that cycle's snapshot records. */
export function DeliverableCycleReport({
  cycle,
  items,
  summary,
  clientName,
  programName,
}: {
  cycle: DeliverableCycle;
  items: EnrollmentDeliverable[];
  summary: DeliverableSummary;
  clientName: string;
  programName: string;
}) {
  const delivered = items.filter((item) => isDoneStatus(item.status));
  const available = items.filter((item) => item.status === "AVAILABLE");
  const notApplicable = items.filter((item) => item.status === "NOT_APPLICABLE");
  const other = items.filter(
    (item) =>
      !isDoneStatus(item.status) && item.status !== "AVAILABLE" && item.status !== "NOT_APPLICABLE",
  );

  return (
    <div className="space-y-4 text-sm">
      <div>
        <h3 className="font-display text-base font-semibold">
          {cycle.label} Program Delivery Report
        </h3>
        <p className="text-muted-foreground">Client: {clientName}</p>
        <p className="text-muted-foreground">Program: {programName}</p>
        {cycle.status === "FINALIZED" && cycle.finalizedAt && (
          <p className="text-xs text-muted-foreground">
            Finalized {new Date(cycle.finalizedAt).toLocaleDateString()}
            {cycle.finalizedByDisplayName ? ` by ${cycle.finalizedByDisplayName}` : ""}
          </p>
        )}
      </div>
      <ul className="space-y-0.5">
        <li>{summary.total} deliverables tracked</li>
        <li>{summary.deliveredOrCompleted} delivered/completed</li>
        <li>{summary.available} available</li>
        <li>{summary.notApplicable} not applicable</li>
        {other.length > 0 && <li>{other.length} still open</li>}
      </ul>
      <ReportSection title="Delivered this period" items={delivered} done />
      <ReportSection title="Available" items={available} />
      <ReportSection title="Still open" items={other} />
      <ReportSection title="Not applicable" items={notApplicable} />
    </div>
  );
}

/** What a report line adds under the title: the outcome when done, the status when still open. */
function detail(item: EnrollmentDeliverable, done: boolean): string {
  // The section heading already says delivered / available / not applicable.
  const settled = done || item.status === "NOT_APPLICABLE" || item.status === "AVAILABLE";
  const lead = settled ? item.outcome : deliverableStatusLine(item);
  return [lead, item.notes].filter(Boolean).join(" · ");
}

function ReportSection({
  title,
  items,
  done = false,
}: {
  title: string;
  items: EnrollmentDeliverable[];
  done?: boolean;
}) {
  if (items.length === 0) return null;
  return (
    <section>
      <h4 className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
        {title}
      </h4>
      <ul className="mt-1 space-y-1.5">
        {items.map((item) => (
          <li key={item.id}>
            <p className="flex items-center gap-1.5">
              {done && <Check className="h-3.5 w-3.5 text-success" aria-hidden />}
              {item.titleSnapshot}
            </p>
            {detail(item, done) && (
              <p className="pl-5 text-xs text-muted-foreground">{detail(item, done)}</p>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
