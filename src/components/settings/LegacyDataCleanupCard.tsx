import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  acfApplyLegacyData,
  acfPreviewLegacyData,
  type LegacyContractItem,
  type LegacyDataReport,
} from "@/lib/apiClient";

const LINK_LABELS: Record<keyof LegacyDataReport["linked"], string> = {
  formAssignments: "forms already sent",
  contracts: "contracts",
  terms: "terms",
  finalReports: "final reports",
  documentAssignments: "document requests",
  communications: "emails",
};

function totalLinked(report: LegacyDataReport) {
  return Object.values(report.linked).reduce((sum, count) => sum + count, 0);
}

function hasLegacyWork(report: LegacyDataReport) {
  return (
    report.contracts.remove.length > 0 ||
    report.contracts.cancel.length > 0 ||
    totalLinked(report) > 0 ||
    (report.profilesFilled?.length ?? 0) > 0 ||
    report.orphans.clientIds > 0
  );
}

function ContractList({ title, items }: { title: string; items: LegacyContractItem[] }) {
  if (!items.length) return null;
  return (
    <div className="space-y-1">
      <p className="text-sm font-medium">
        {title} ({items.length})
      </p>
      <ul className="space-y-0.5 text-sm text-muted-foreground">
        {items.map((item) => (
          <li key={item.contractId}>
            <Link
              to="/clients/$clientId"
              params={{ clientId: item.clientId }}
              className="hover:underline"
            >
              {item.businessName ?? "Unknown client"}
            </Link>
            {item.programName ? ` · ${item.programName}` : ""} ·{" "}
            {new Date(item.createdAt).toLocaleDateString()}
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Org admins: preview, then apply, the cleanup that brings existing clients in line with the current
 * workflow (old placeholder contracts, records from before enrollments, rows of deleted clients).
 */
export function LegacyDataCleanupCard() {
  const [report, setReport] = useState<LegacyDataReport | null>(null);
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);

  async function preview() {
    setBusy("preview");
    try {
      setReport(await acfPreviewLegacyData());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to check for legacy data.");
    } finally {
      setBusy(null);
    }
  }

  async function apply() {
    setBusy("apply");
    try {
      const result = await acfApplyLegacyData();
      setReport(result);
      toast.success("Legacy data cleaned up.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to clean up legacy data.");
    } finally {
      setBusy(null);
    }
  }

  const linked = report
    ? (Object.keys(LINK_LABELS) as Array<keyof LegacyDataReport["linked"]>)
        .filter((key) => report.linked[key] > 0)
        .map((key) => `${report.linked[key]} ${LINK_LABELS[key]}`)
    : [];

  return (
    <Card className="shadow-card">
      <CardHeader>
        <CardTitle className="font-display text-base">Legacy data cleanup</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Removes the old placeholder contracts created before program contract templates, attaches
          forms and records sent before enrollments existed to the right program, fills blank client
          profile details from intake answers already submitted, and clears rows left by deleted
          clients. Signed contracts and details staff entered are always kept. Preview first;
          nothing changes until you apply.
        </p>

        {report && (
          <div className="space-y-3 rounded-lg border border-border p-4">
            {report.applied && <p className="text-sm font-medium">Applied. Summary of changes:</p>}
            {!hasLegacyWork(report) && report.clientsNeedingContract.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing to clean up.</p>
            ) : (
              <>
                <ContractList
                  title={
                    report.applied ? "Old drafts removed" : "Old drafts to remove (never sent)"
                  }
                  items={report.contracts.remove}
                />
                <ContractList
                  title={
                    report.applied
                      ? "Old drafts cancelled"
                      : "Old drafts out for signature (link will be cancelled)"
                  }
                  items={report.contracts.cancel}
                />
                <ContractList title="Old contracts kept (signed)" items={report.contracts.keep} />
                {linked.length > 0 && (
                  <p className="text-sm">
                    {report.applied
                      ? "Attached to their program: "
                      : "Will attach to their program: "}
                    {linked.join(", ")}.
                  </p>
                )}
                {(report.profilesFilled?.length ?? 0) > 0 && (
                  <p className="text-sm">
                    {report.applied ? "Filled" : "Will fill"} blank profile details from submitted
                    intake answers for {report.profilesFilled?.length} client
                    {report.profilesFilled?.length === 1 ? "" : "s"}:{" "}
                    {report.profilesFilled?.map((entry) => entry.businessName).join(", ")}.
                  </p>
                )}
                {report.orphans.clientIds > 0 && (
                  <p className="text-sm">
                    {report.applied ? "Cleared" : "Will clear"} records of{" "}
                    {report.orphans.clientIds} deleted client
                    {report.orphans.clientIds === 1 ? "" : "s"}.
                  </p>
                )}
                {report.clientsNeedingContract.length > 0 && (
                  <div className="space-y-1">
                    <p className="text-sm font-medium">
                      Need a contract from their program ({report.clientsNeedingContract.length})
                    </p>
                    <p className="text-xs text-muted-foreground">
                      Their old draft was their only contract. Open each client and use Send
                      contract to send the program's real contract.
                    </p>
                    <ul className="space-y-0.5 text-sm text-muted-foreground">
                      {report.clientsNeedingContract.map((entry) => (
                        <li key={entry.enrollmentId}>
                          <Link
                            to="/clients/$clientId"
                            params={{ clientId: entry.clientId }}
                            className="hover:underline"
                          >
                            {entry.businessName || "Unknown client"}
                          </Link>
                          {entry.programName ? ` · ${entry.programName}` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={busy !== null} onClick={preview}>
            {busy === "preview" ? "Checking…" : report ? "Check again" : "Preview cleanup"}
          </Button>
          {report && !report.applied && hasLegacyWork(report) && (
            <Button type="button" disabled={busy !== null} onClick={apply}>
              {busy === "apply" ? "Applying…" : "Apply cleanup"}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
