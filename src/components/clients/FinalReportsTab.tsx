import { Printer } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { ProgramHistoryReport } from "@/components/clients/ProgramHistoryReport";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { finalizeFinalReport, saveFinalReportDraft } from "@/lib/api";
import { ApiError, type FinalReportNarrative } from "@/lib/apiClient";
import {
  FINISHED_OUTCOMES,
  PROGRAM_OUTCOMES,
  isFinalized,
  printElement,
} from "@/lib/final-reports";
import { formatMoney } from "@/lib/money";
import type { ProgramHistory } from "@/lib/program-deliverables";
import type { Client, FinalReport, ProgramEnrollment, Terms } from "@/types";

const EMPTY: Required<FinalReportNarrative> = {
  resultsAchieved: "",
  issuesEncountered: "",
  staffComments: "",
  clientOutcome: "",
  recommendedNextSteps: "",
};

const NARRATIVE_LABELS: [keyof FinalReportNarrative, string][] = [
  ["resultsAchieved", "Results achieved"],
  ["issuesEncountered", "Issues encountered"],
  ["staffComments", "Staff comments"],
  ["clientOutcome", "Client outcome"],
  ["recommendedNextSteps", "Recommended next steps"],
];

/**
 * Final Report tab. Staff write a draft (saving it changes nothing else), then finalize it, which
 * keeps a snapshot of the report and archives the client's participation in that one program.
 */
export function FinalReportsTab({
  client,
  enrollment,
  programName,
  terms,
  reports,
}: {
  client: Client;
  enrollment: ProgramEnrollment | null;
  programName: string;
  /** Terms records for the selected enrollment. */
  terms: Terms[];
  reports: FinalReport[];
}) {
  const finalized = reports.filter(isFinalized);
  const draft = enrollment
    ? (reports.find((report) => !isFinalized(report) && report.enrollmentId === enrollment.id) ??
      null)
    : null;
  const enrollmentFinalized = enrollment
    ? finalized.some((report) => report.enrollmentId === enrollment.id)
    : false;

  return (
    <div className="space-y-3">
      {finalized.map((report) => (
        <FinalizedReportCard key={report.id} report={report} client={client} />
      ))}
      {!enrollment ? (
        <Card className="shadow-card">
          <CardContent className="p-5 text-sm text-muted-foreground">
            Select a program enrollment in “Working in” to write its final report.
          </CardContent>
        </Card>
      ) : enrollmentFinalized ? (
        <Card className="shadow-card">
          <CardContent className="p-5 text-sm text-muted-foreground">
            The final report for {programName} is finalized and this participation is archived.
          </CardContent>
        </Card>
      ) : (
        <DraftEditor
          key={`${enrollment.id}:${draft?.id ?? "new"}`}
          client={client}
          enrollment={enrollment}
          programName={programName}
          terms={terms}
          draft={draft}
        />
      )}
    </div>
  );
}

function FundingFigures({
  statedNeed,
  termsAmount,
}: {
  /** Undefined on a report finalized before reports kept their own copy. */
  statedNeed: string | null | undefined;
  termsAmount: string | null;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2" aria-label="Funding figures">
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Stated funding need
        </p>
        <p className="text-sm">
          {statedNeed === undefined
            ? "Not recorded with this report"
            : (statedNeed ?? "Not provided on the intake")}
        </p>
        <p className="text-xs text-muted-foreground">What the client asked for on the intake.</p>
      </div>
      <div>
        <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
          Terms amount
        </p>
        <p className="text-sm">{termsAmount ?? "No terms recorded"}</p>
        <p className="text-xs text-muted-foreground">As agreed in Terms. Not an amount awarded.</p>
      </div>
    </div>
  );
}

function DraftEditor({
  client,
  enrollment,
  programName,
  terms,
  draft,
}: {
  client: Client;
  enrollment: ProgramEnrollment;
  programName: string;
  terms: Terms[];
  draft: FinalReport | null;
}) {
  const [fields, setFields] = useState<Required<FinalReportNarrative>>(() =>
    draft
      ? {
          resultsAchieved: draft.resultsAchieved,
          issuesEncountered: draft.issuesEncountered,
          staffComments: draft.staffComments,
          clientOutcome: draft.clientOutcome,
          recommendedNextSteps: draft.recommendedNextSteps,
        }
      : EMPTY,
  );
  const [history, setHistory] = useState<ProgramHistory | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<string | null>(draft?.updatedAt ?? null);
  const [confirming, setConfirming] = useState(false);
  const latestTerms = terms[0];
  const termsAmount =
    latestTerms && latestTerms.fundingAmount > 0 ? formatMoney(latestTerms.fundingAmount) : null;

  async function saveDraft() {
    setSaving(true);
    try {
      const saved = await saveFinalReportDraft(client.id, enrollment.id, fields, draft?.id);
      setSavedAt(saved.updatedAt ?? new Date().toISOString());
      toast.success("Draft saved. Nothing else about the client changed.");
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't save the draft.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card className="shadow-card">
      <CardContent className="space-y-4 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="font-display text-base">Final report — {programName}</CardTitle>
          <Badge variant="outline">{draft ? "Draft" : "New draft"}</Badge>
        </div>
        <div className="rounded-md border border-border p-4">
          <ProgramHistoryReport enrollmentId={enrollment.id} onLoaded={setHistory} />
        </div>
        <FundingFigures
          statedNeed={history?.originalRequest.budgetNeed ?? null}
          termsAmount={termsAmount}
        />
        {NARRATIVE_LABELS.map(([key, label]) => (
          <div key={key} className="space-y-1.5">
            <Label htmlFor={`final-${key}`}>{label}</Label>
            {key === "clientOutcome" ? (
              <Input
                id={`final-${key}`}
                value={fields[key]}
                onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
              />
            ) : (
              <Textarea
                id={`final-${key}`}
                rows={2}
                value={fields[key]}
                onChange={(event) => setFields({ ...fields, [key]: event.target.value })}
              />
            )}
          </div>
        ))}
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" disabled={saving} onClick={() => void saveDraft()}>
            {saving ? "Saving…" : "Save draft"}
          </Button>
          <Button disabled={saving} onClick={() => setConfirming(true)}>
            Finalize report & archive…
          </Button>
          {savedAt && (
            <span className="text-xs text-muted-foreground">
              Draft saved {new Date(savedAt).toLocaleString()}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Saving a draft changes nothing else: participation, billing and monthly checklists stay as
          they are.
        </p>
      </CardContent>
      <FinalizeDialog
        open={confirming}
        onOpenChange={setConfirming}
        clientName={client.businessName}
        programName={programName}
        onConfirm={async (outcome) => {
          // Save the latest edits as the draft first, then finalize that draft.
          const saved = await saveFinalReportDraft(client.id, enrollment.id, fields, draft?.id);
          await finalizeFinalReport(saved, { ...fields, outcome });
          toast.success(
            `Final report finalized. ${client.businessName}'s ${programName} participation is archived.`,
          );
        }}
      />
    </Card>
  );
}

function FinalizeDialog({
  open,
  onOpenChange,
  clientName,
  programName,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientName: string;
  programName: string;
  onConfirm: (outcome: string) => Promise<void>;
}) {
  const [outcome, setOutcome] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setOutcome("");
  }, [open]);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm(outcome);
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof ApiError ? error.message : "Couldn't finalize the report.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">
            Finalize report & archive participation?
          </DialogTitle>
          <DialogDescription>
            For {clientName} in {programName}.
          </DialogDescription>
        </DialogHeader>
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>The report becomes read-only and keeps a copy of today’s program history.</li>
          <li>
            {clientName}’s participation in {programName} is archived: its billing agreement ends
            and no new monthly checklists start.
          </li>
          <li>{clientName}’s other programs and client record stay active.</li>
        </ul>
        <div className="space-y-1.5">
          <Label>Program outcome</Label>
          <Select value={outcome} onValueChange={setOutcome}>
            <SelectTrigger aria-label="Program outcome">
              <SelectValue placeholder="Choose how the program ended" />
            </SelectTrigger>
            <SelectContent>
              {PROGRAM_OUTCOMES.map((value) => (
                <SelectItem key={value} value={value}>
                  {value}
                  {FINISHED_OUTCOMES.includes(value) ? "" : " (ended early)"}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!outcome || busy} onClick={() => void confirm()}>
            {busy ? "Finalizing…" : "Finalize & archive participation"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FinalizedReportCard({ report, client }: { report: FinalReport; client: Client }) {
  const snapshot = report.snapshot ?? null;
  const cardId = `final-report-${report.id}`;
  return (
    <Card className="shadow-card" id={cardId} aria-label="Finalized final report">
      <CardContent className="space-y-4 p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="font-display text-base">
              Final report — {snapshot?.programName || report.supportProvided}
            </CardTitle>
            <p className="text-sm text-muted-foreground">
              {snapshot?.businessName || client.businessName}
              {report.finalizedAt
                ? ` · Finalized ${new Date(report.finalizedAt).toLocaleDateString()}`
                : ""}
              {report.finalizedByDisplayName ? ` by ${report.finalizedByDisplayName}` : ""}
            </p>
            {report.archiveDecision && (
              <p className="text-sm">Program outcome: {report.archiveDecision}</p>
            )}
          </div>
          <Button
            size="sm"
            variant="outline"
            className="no-print"
            onClick={() => printElement(cardId)}
          >
            <Printer className="h-4 w-4" /> Print / Save as PDF
          </Button>
        </div>
        <p className="text-sm">
          <span className="text-muted-foreground">Program term:</span>{" "}
          {report.startDate ? report.startDate.slice(0, 10) : "—"} →{" "}
          {report.endDate ? report.endDate.slice(0, 10) : "—"}
        </p>
        <FundingFigures
          statedNeed={snapshot ? snapshot.statedFundingNeed : undefined}
          termsAmount={snapshot ? snapshot.termsAmount : report.fundingProvided || null}
        />
        <dl className="grid gap-x-8 gap-y-2 sm:grid-cols-2">
          {NARRATIVE_LABELS.map(([key, label]) => (
            <div key={key}>
              <dt className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground">
                {label}
              </dt>
              <dd className="whitespace-pre-wrap text-sm">{report[key] || "—"}</dd>
            </div>
          ))}
        </dl>
        <div className="border-t border-border pt-4">
          {snapshot ? (
            <ProgramHistoryReport history={snapshot.history} />
          ) : report.enrollmentId ? (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                Finalized before reports kept their own copy: showing the current records.
              </p>
              <ProgramHistoryReport enrollmentId={report.enrollmentId} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">{report.originalNeed}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
