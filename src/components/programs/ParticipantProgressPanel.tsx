import { StatusBadge } from "@/components/StatusBadge";
import type {
  Contract,
  EnrollmentMonitoring,
  EnrollmentStatusHistory,
  ProgramEnrollment,
  Terms,
} from "@/types";

function formatDate(value?: string | null) {
  return value ? new Date(value).toLocaleDateString() : "Not set";
}

export function ParticipantProgressPanel({
  enrollment,
  assignedStaffName,
  lastModifiedByName,
  terms,
  contracts,
  monitoring,
  statusHistory,
}: {
  enrollment: ProgramEnrollment;
  assignedStaffName: string;
  lastModifiedByName: string;
  terms: Terms[];
  contracts: Contract[];
  monitoring: EnrollmentMonitoring[];
  statusHistory: EnrollmentStatusHistory[];
}) {
  const compliantMonitoring = monitoring.filter(
    (item) => item.complianceStatus === "compliant",
  ).length;
  const overdueMonitoring = monitoring.filter(
    (item) => item.active && item.nextReviewAt && new Date(item.nextReviewAt) < new Date(),
  ).length;

  return (
    <div className="grid gap-6 border-t border-border pt-5 lg:grid-cols-4">
      <section>
        <h4 className="font-display text-sm font-semibold">Enrollment</h4>
        <dl className="mt-3 space-y-2 text-sm">
          <div>
            <dt className="text-xs text-muted-foreground">Started</dt>
            <dd>{formatDate(enrollment.startDate)}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Assigned staff</dt>
            <dd>{assignedStaffName}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Last changed by</dt>
            <dd>{lastModifiedByName}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Next action</dt>
            <dd>{enrollment.nextAction || "None scheduled"}</dd>
          </div>
        </dl>
      </section>
      <section>
        <h4 className="font-display text-sm font-semibold">Terms</h4>
        {terms.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No terms created.</p>
        ) : (
          terms.map((item) => (
            <div key={item.id} className="mt-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span>{item.supportType}</span>
                <StatusBadge status={item.approvalStatus} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                ${item.fundingAmount.toLocaleString()} · {formatDate(item.startDate)} to{" "}
                {formatDate(item.endDate)}
              </p>
            </div>
          ))
        )}
      </section>
      <section>
        <h4 className="font-display text-sm font-semibold">Contracts</h4>
        {contracts.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No contracts created.</p>
        ) : (
          contracts.map((item) => (
            <div key={item.id} className="mt-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span>{item.contractType}</span>
                <StatusBadge status={item.status} />
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {item.signedAt
                  ? `Signed ${formatDate(item.signedAt)}`
                  : item.sentAt
                    ? `Sent ${formatDate(item.sentAt)}`
                    : "Not sent"}
              </p>
            </div>
          ))
        )}
      </section>
      <section>
        <h4 className="font-display text-sm font-semibold">Monitoring</h4>
        <p className="mt-3 text-sm">
          {compliantMonitoring} of {monitoring.length} compliant
        </p>
        <p
          className={`mt-1 text-xs ${overdueMonitoring ? "text-destructive" : "text-muted-foreground"}`}
        >
          {overdueMonitoring ? `${overdueMonitoring} overdue` : "Nothing overdue"}
        </p>
        {monitoring.slice(0, 3).map((item) => (
          <div key={item.id} className="mt-3 border-t border-border pt-2 text-xs">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>{item.name}</span>
              <StatusBadge status={item.complianceStatus} />
            </div>
            <p className="mt-1 text-muted-foreground">
              Next review {formatDate(item.nextReviewAt)}
            </p>
          </div>
        ))}
      </section>
      <section className="border-t border-border pt-5 lg:col-span-4">
        <h4 className="font-display text-sm font-semibold">Enrollment history</h4>
        {statusHistory.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">No status changes recorded.</p>
        ) : (
          <ol className="mt-3 divide-y divide-border">
            {[...statusHistory].reverse().map((item) => (
              <li key={item.id} className="grid gap-2 py-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
                <StatusBadge status={item.newStatus} />
                <div className="text-sm">
                  <span>Changed by {item.changedByDisplayName || "Unknown user"}</span>
                  {item.reason && <p className="text-xs text-muted-foreground">{item.reason}</p>}
                </div>
                <time className="text-xs text-muted-foreground" dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString()}
                </time>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
