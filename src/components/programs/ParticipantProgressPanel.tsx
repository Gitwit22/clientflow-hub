import { StatusBadge } from "@/components/StatusBadge";
import type { Contract, MonitoringItem, ProgramEnrollment, Terms } from "@/types";

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : "Not set";
}

export function ParticipantProgressPanel({
  enrollment,
  terms,
  contracts,
  monitoring,
}: {
  enrollment: ProgramEnrollment;
  terms: Terms[];
  contracts: Contract[];
  monitoring: MonitoringItem[];
}) {
  const completedMonitoring = monitoring.filter((item) => item.status.toLowerCase() === "completed").length;
  const overdueMonitoring = monitoring.filter(
    (item) => item.status.toLowerCase() !== "completed" && new Date(item.dueDate) < new Date(),
  ).length;

  return (
    <div className="grid gap-6 border-t border-border pt-5 lg:grid-cols-4">
      <section>
        <h4 className="font-display text-sm font-semibold">Enrollment</h4>
        <dl className="mt-3 space-y-2 text-sm">
          <div><dt className="text-xs text-muted-foreground">Started</dt><dd>{formatDate(enrollment.startDate)}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Assigned staff</dt><dd>{enrollment.assignedStaff || "Unassigned"}</dd></div>
          <div><dt className="text-xs text-muted-foreground">Next action</dt><dd>{enrollment.nextAction || "None scheduled"}</dd></div>
        </dl>
      </section>
      <section>
        <h4 className="font-display text-sm font-semibold">Terms</h4>
        {terms.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No terms created.</p> : terms.map((item) => (
          <div key={item.id} className="mt-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><span>{item.supportType}</span><StatusBadge status={item.approvalStatus} /></div>
            <p className="mt-1 text-xs text-muted-foreground">${item.fundingAmount.toLocaleString()} · {formatDate(item.startDate)} to {formatDate(item.endDate)}</p>
          </div>
        ))}
      </section>
      <section>
        <h4 className="font-display text-sm font-semibold">Contracts</h4>
        {contracts.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">No contracts created.</p> : contracts.map((item) => (
          <div key={item.id} className="mt-3 text-sm">
            <div className="flex flex-wrap items-center gap-2"><span>{item.contractType}</span><StatusBadge status={item.status} /></div>
            <p className="mt-1 text-xs text-muted-foreground">{item.signedAt ? `Signed ${formatDate(item.signedAt)}` : item.sentAt ? `Sent ${formatDate(item.sentAt)}` : "Not sent"}</p>
          </div>
        ))}
      </section>
      <section>
        <h4 className="font-display text-sm font-semibold">Monitoring</h4>
        <p className="mt-3 text-sm">{completedMonitoring} of {monitoring.length} completed</p>
        <p className={`mt-1 text-xs ${overdueMonitoring ? "text-destructive" : "text-muted-foreground"}`}>
          {overdueMonitoring ? `${overdueMonitoring} overdue` : "Nothing overdue"}
        </p>
        {monitoring.slice(0, 3).map((item) => (
          <div key={item.id} className="mt-3 border-t border-border pt-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2"><span>{item.type}</span><StatusBadge status={item.status} /></div>
            <p className="mt-1 text-muted-foreground">Due {formatDate(item.dueDate)}</p>
          </div>
        ))}
      </section>
    </div>
  );
}