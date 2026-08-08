import { useState } from "react";
import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SendFormDialog } from "@/components/dialogs/SendFormDialog";
import { TermsDialog } from "@/components/dialogs/TermsDialog";
import { useAppState } from "@/lib/store";
import {
  addCommunication,
  archiveClient,
  createFinalReport,
  generateContract,
  updateClient,
} from "@/lib/api";
import { ARCHIVE_DECISIONS } from "@/types";

export const Route = createFileRoute("/clients/$clientId")({
  head: () => ({
    meta: [
      { title: "Client profile — ClientFlow" },
      {
        name: "description",
        content:
          "Full client profile: intake, forms, terms, monitoring, documents, contracts and final report.",
      },
      { property: "og:title", content: "Client profile — ClientFlow" },
      {
        property: "og:description",
        content:
          "Full client profile: intake, forms, terms, monitoring, documents, contracts and final report.",
      },
    ],
  }),
  component: ClientProfile,
});

function Row({ label, value }: { label: string; value?: string }) {
  return (
    <div className="border-b border-border py-2 last:border-0">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="mt-0.5 text-sm">{value || "—"}</dd>
    </div>
  );
}

function ClientProfile() {
  const { clientId } = Route.useParams();
  const s = useAppState();
  const client = s.clients.find((c) => c.id === clientId);
  const [sendOpen, setSendOpen] = useState(false);
  const [termsOpen, setTermsOpen] = useState(false);
  const [note, setNote] = useState("");
  const [report, setReport] = useState({
    resultsAchieved: "",
    staffComments: "",
    clientOutcome: "Program Complete",
    archiveDecision: ARCHIVE_DECISIONS[0],
  });

  if (!client)
    return (
      <p className="text-sm text-muted-foreground">
        Client not found.{" "}
        <Link to="/clients" className="text-primary">
          Back to clients
        </Link>
      </p>
    );

  const program = s.programs.find((p) => p.id === client.programId);
  const assignments = s.formAssignments.filter((a) => a.clientId === client.id);
  const terms = s.terms.filter((t) => t.clientId === client.id);
  const monitoring = s.monitoring.filter((m) => m.clientId === client.id);
  const docs = s.documents.filter((d) => d.clientId === client.id);
  const comms = s.communications.filter((c) => c.clientId === client.id);
  const contracts = s.contracts.filter((c) => c.clientId === client.id);
  const finals = s.finalReports.filter((f) => f.clientId === client.id);
  const logs = s.activity.filter((a) => a.clientId === client.id);
  const templateName = (id: string) => s.formTemplates.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      <PageHeader
        title={client.businessName}
        description={`${client.primaryContactName} · ${client.email} · ${client.phone}`}
        actions={
          <>
            <Button onClick={() => setSendOpen(true)}>Send program form</Button>
            <Button variant="outline" onClick={() => setTermsOpen(true)}>
              Create terms
            </Button>
            <Button
              variant="outline"
              onClick={async () => {
                await generateContract(client.id, terms[0]?.id);
                toast.success("Draft contract generated");
              }}
            >
              Generate contract
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                updateClient(client.id, {
                  nextFollowUpDate: new Date(Date.now() + 7 * 864e5).toISOString(),
                });
                toast.success("Follow-up scheduled in 7 days");
              }}
            >
              Schedule follow-up
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                archiveClient(client.id);
                toast.success("Moved to archive");
              }}
            >
              Move to archive
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge status={client.status} />
        {client.relationshipType && <StatusBadge status={client.relationshipType} />}
        <span className="text-sm text-muted-foreground">
          {program?.name ?? "Unassigned program"}
        </span>
        <span className="text-sm text-muted-foreground">Staff: {client.assignedStaff}</span>
        <span className="text-sm text-muted-foreground">
          Next follow-up:{" "}
          {client.nextFollowUpDate ? new Date(client.nextFollowUpDate).toLocaleDateString() : "—"}
        </span>
        {client.convertedAt && (
          <span className="text-sm text-muted-foreground">
            Converted: {new Date(client.convertedAt).toLocaleDateString()}
          </span>
        )}
      </div>

      <Tabs defaultValue="overview">
        <TabsList className="flex h-auto flex-wrap justify-start">
          {[
            "overview",
            "intake",
            "forms",
            "terms",
            "monitoring",
            "documents",
            "communications",
            "contracts",
            "final",
            "activity",
          ].map((t) => (
            <TabsTrigger key={t} value={t} className="capitalize">
              {t === "final" ? "Final report" : t}
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value="overview" className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-base">Client summary</CardTitle>
            </CardHeader>
            <CardContent>
              <dl>
                <Row label="Business description" value={client.intake.businessDescription} />
                <Row label="What they need" value={client.intake.assistanceRequested} />
                <Row label="Current program" value={program?.name} />
                <Row label="Current status" value={client.status} />
                <Row
                  label="Internal decision"
                  value={terms[0]?.approvalStatus ?? "Pending review"}
                />
                <Row label="Assigned staff" value={client.assignedStaff} />
                <Row label="Created" value={new Date(client.createdAt).toLocaleDateString()} />
              </dl>
            </CardContent>
          </Card>
          <Card className="shadow-card">
            <CardHeader>
              <CardTitle className="font-display text-base">Open tasks & latest notes</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {monitoring
                .filter((m) => m.status !== "Completed")
                .map((m) => (
                  <div key={m.id} className="rounded-lg border border-border p-3 text-sm">
                    <div className="flex justify-between gap-2">
                      <span className="font-medium">{m.type}</span>
                      <StatusBadge status={m.status} />
                    </div>
                    <p className="mt-1 text-muted-foreground">
                      Due {new Date(m.dueDate).toLocaleDateString()} · {m.notes}
                    </p>
                  </div>
                ))}
              {comms.slice(0, 3).map((c) => (
                <div key={c.id} className="text-sm">
                  <span className="font-medium">{c.subject}</span>
                  <p className="text-muted-foreground">{c.notes}</p>
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="shadow-card lg:col-span-2">
            <CardHeader>
              <CardTitle className="font-display text-base">Snapchat communication</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <dl>
                <Row label="Snapchat username" value={client.snapchat?.username} />
                <Row
                  label="Last Snapchat contact"
                  value={
                    client.snapchat?.lastContactDate
                      ? new Date(client.snapchat.lastContactDate).toLocaleDateString()
                      : undefined
                  }
                />
                <Row label="Communication summary" value={client.snapchat?.summary} />
                <Row
                  label="Follow-up needed"
                  value={client.snapchat?.followUpNeeded ? "Yes" : "No"}
                />
                <Row label="Staff member" value={client.snapchat?.staffMember} />
              </dl>
              <div className="flex items-start">
                <Button
                  variant="outline"
                  onClick={() => window.open("https://web.snapchat.com", "_blank", "noopener")}
                >
                  Open Snapchat Web
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="intake" className="mt-4">
          <Card className="shadow-card">
            <CardContent className="grid gap-x-8 p-6 sm:grid-cols-2">
              <dl>
                <Row label="Client name" value={client.primaryContactName} />
                <Row label="Business name" value={client.businessName} />
                <Row label="Email" value={client.email} />
                <Row label="Phone" value={client.phone} />
                <Row label="Website" value={client.website} />
                <Row label="Social media links" value={client.socialLinks?.join(", ")} />
                <Row label="Business description" value={client.intake.businessDescription} />
              </dl>
              <dl>
                <Row
                  label="Type of assistance requested"
                  value={client.intake.assistanceRequested}
                />
                <Row label="Program of interest" value={client.intake.programOfInterest} />
                <Row label="Budget or funding need" value={client.intake.budgetNeed} />
                <Row label="Preferred contact method" value={client.intake.preferredContact} />
                <Row label="How they heard about us" value={client.intake.heardAboutUs} />
                <Row label="Additional comments" value={client.intake.additionalComments} />
                <Row label="Uploaded files" value={client.intake.uploadedFiles.join(", ")} />
              </dl>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="forms" className="mt-4 space-y-3">
          {assignments.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No forms have been assigned to this profile yet.
            </p>
          )}
          {assignments.map((a) => {
            const prog = s.formTemplates.find((t) => t.id === a.formId);
            const progName = prog
              ? (s.programs.find((p) => p.id === prog.programId)?.name ?? "—")
              : "—";
            return (
              <Card key={a.id} className="shadow-card">
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{templateName(a.formId)}</p>
                      <p className="text-xs text-muted-foreground">{progName}</p>
                    </div>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="grid gap-x-6 gap-y-1 text-xs text-muted-foreground sm:grid-cols-3">
                    <span>
                      Method:{" "}
                      <span className="capitalize font-medium text-foreground">
                        {a.completionMethod?.replace(/_/g, " ") ?? "—"}
                      </span>
                    </span>
                    <span>Sent: {a.sentAt ? new Date(a.sentAt).toLocaleDateString() : "—"}</span>
                    <span>Due: {a.dueDate ? new Date(a.dueDate).toLocaleDateString() : "—"}</span>
                    <span>
                      Opened: {a.openedAt ? new Date(a.openedAt).toLocaleDateString() : "—"}
                    </span>
                    <span>
                      Submitted:{" "}
                      {a.submittedAt ? new Date(a.submittedAt).toLocaleDateString() : "—"}
                    </span>
                    <span>Staff: {a.assignedUserId ?? client.assignedStaff}</span>
                  </div>
                  {a.secureLink && (
                    <p className="font-mono text-xs text-muted-foreground truncate">
                      {a.secureLink}
                    </p>
                  )}
                  {/* Status-based actions */}
                  <div className="flex flex-wrap gap-2">
                    {a.status === "draft" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toast("Form opened for editing")}
                        >
                          Continue
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toast("Form sent to client")}
                        >
                          Send to Client
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toast("Form cancelled")}>
                          Cancel
                        </Button>
                      </>
                    )}
                    {(["sent", "delivered", "opened", "in_progress"] as const).includes(
                      a.status as "sent" | "delivered" | "opened" | "in_progress",
                    ) && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toast.success("Form resent")}
                        >
                          Resend
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toast("Preview opened")}>
                          Preview
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toast("Opening form with client")}
                        >
                          Fill Out With Client
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toast("Link cancelled")}>
                          Cancel Link
                        </Button>
                      </>
                    )}
                    {a.status === "submitted" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toast("Reviewing answers")}
                        >
                          Review Answers
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toast("Attachments opened")}
                        >
                          View Attachments
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toast("Note added")}>
                          Add Note
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toast("Status updated")}>
                          Change Status
                        </Button>
                      </>
                    )}
                    {a.status === "under_review" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toast("Reviewing answers")}
                        >
                          Review Answers
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toast("Status updated")}>
                          Change Status
                        </Button>
                      </>
                    )}
                    {a.status === "approved" && (
                      <>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => toast("Viewing submission")}
                        >
                          View Submission
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => toast("Attachments opened")}
                        >
                          View Attachments
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toast("Downloading")}>
                          Download
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => toast("Archived")}>
                          Archive
                        </Button>
                      </>
                    )}
                    {(a.status === "cancelled" || a.status === "expired") && (
                      <span className="text-xs text-muted-foreground self-center">
                        No actions available
                      </span>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
          <Button onClick={() => setSendOpen(true)}>Assign a form</Button>
        </TabsContent>

        <TabsContent value="terms" className="mt-4 space-y-3">
          {terms.map((t) => (
            <Card key={t.id} className="shadow-card">
              <CardContent className="grid gap-x-8 p-6 sm:grid-cols-2">
                <dl>
                  <Row label="Support type" value={t.supportType} />
                  <Row label="Funding amount" value={`$${t.fundingAmount.toLocaleString()}`} />
                  <Row
                    label="Grant / Loan / Forgivable"
                    value={`$${t.grantAmount.toLocaleString()} / $${t.loanAmount.toLocaleString()} / $${t.forgivableAmount.toLocaleString()}`}
                  />
                  <Row label="Repayment required" value={t.repaymentRequired ? "Yes" : "No"} />
                  <Row label="Repayment schedule" value={t.repaymentSchedule} />
                  <Row label="Interest" value={t.interestDescription} />
                </dl>
                <dl>
                  <Row label="Milestones" value={t.milestones} />
                  <Row label="Reporting requirements" value={t.reportingRequirements} />
                  <Row
                    label="Term"
                    value={`${t.startDate.slice(0, 10)} → ${t.endDate.slice(0, 10)}`}
                  />
                  <Row label="Monitoring frequency" value={t.monitoringFrequency} />
                  <Row label="Special conditions" value={t.specialConditions} />
                  <Row label="Internal approval" value={t.approvalStatus} />
                </dl>
              </CardContent>
            </Card>
          ))}
          <Button onClick={() => setTermsOpen(true)}>Create terms</Button>
        </TabsContent>

        <TabsContent value="monitoring" className="mt-4 space-y-3">
          {monitoring.map((m) => (
            <Card key={m.id} className="shadow-card">
              <CardContent className="flex items-center justify-between gap-4 p-5">
                <div>
                  <p className="font-medium">{m.type}</p>
                  <p className="text-xs text-muted-foreground">
                    Due {new Date(m.dueDate).toLocaleDateString()} · {m.assignedStaff} · {m.notes}
                  </p>
                </div>
                <StatusBadge status={m.status} />
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="documents" className="mt-4 space-y-3">
          {docs.map((d) => (
            <Card key={d.id} className="shadow-card">
              <CardContent className="flex items-center justify-between p-5">
                <div>
                  <p className="font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {d.type} · {d.uploadedBy} · {new Date(d.uploadedAt).toLocaleDateString()}
                  </p>
                </div>
                <Button size="sm" variant="outline">
                  Download
                </Button>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="communications" className="mt-4 space-y-3">
          <Card className="shadow-card">
            <CardContent className="space-y-3 p-5">
              <Label>Add a note</Label>
              <Textarea
                rows={3}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Log a call, email or meeting…"
              />
              <Button
                onClick={async () => {
                  if (!note.trim()) return;
                  await addCommunication(client.id, {
                    type: "Note",
                    direction: "Internal",
                    subject: "Staff note",
                    notes: note,
                    date: new Date().toISOString(),
                    staffMember: client.assignedStaff,
                  });
                  setNote("");
                  toast.success("Note added");
                }}
              >
                Add note
              </Button>
            </CardContent>
          </Card>
          {comms.map((c) => (
            <Card key={c.id} className="shadow-card">
              <CardContent className="p-5">
                <div className="flex justify-between gap-3">
                  <p className="font-medium">{c.subject}</p>
                  <StatusBadge status={c.type} />
                </div>
                <p className="mt-1 text-sm text-muted-foreground">{c.notes}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  {c.direction} · {c.staffMember} · {new Date(c.date).toLocaleDateString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="contracts" className="mt-4 space-y-3">
          {contracts.map((c) => (
            <Card key={c.id} className="shadow-card">
              <CardContent className="p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="font-medium">{c.contractType}</p>
                  <StatusBadge status={c.status} />
                </div>
                <pre className="mt-3 max-h-64 overflow-auto rounded-lg bg-muted p-4 font-sans text-xs whitespace-pre-wrap text-muted-foreground">
                  {c.content}
                </pre>
              </CardContent>
            </Card>
          ))}
        </TabsContent>

        <TabsContent value="final" className="mt-4 space-y-3">
          {finals.map((f) => (
            <Card key={f.id} className="shadow-card">
              <CardContent className="grid gap-x-8 p-6 sm:grid-cols-2">
                <dl>
                  <Row
                    label="Program term"
                    value={`${f.startDate.slice(0, 10)} → ${f.endDate.slice(0, 10)}`}
                  />
                  <Row label="Original need" value={f.originalNeed} />
                  <Row label="Support provided" value={f.supportProvided} />
                  <Row label="Funding provided" value={f.fundingProvided} />
                  <Row label="Milestones completed" value={f.milestonesCompleted} />
                </dl>
                <dl>
                  <Row label="Results achieved" value={f.resultsAchieved} />
                  <Row label="Issues encountered" value={f.issuesEncountered} />
                  <Row label="Staff comments" value={f.staffComments} />
                  <Row label="Client outcome" value={f.clientOutcome} />
                  <Row label="Archive decision" value={f.archiveDecision} />
                </dl>
              </CardContent>
            </Card>
          ))}
          <Card className="shadow-card">
            <CardContent className="space-y-3 p-5">
              <CardTitle className="font-display text-base">Complete final report</CardTitle>
              <div className="space-y-1.5">
                <Label>Results achieved</Label>
                <Textarea
                  rows={2}
                  value={report.resultsAchieved}
                  onChange={(e) => setReport({ ...report, resultsAchieved: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Staff comments</Label>
                <Textarea
                  rows={2}
                  value={report.staffComments}
                  onChange={(e) => setReport({ ...report, staffComments: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Client outcome</Label>
                <Input
                  value={report.clientOutcome}
                  onChange={(e) => setReport({ ...report, clientOutcome: e.target.value })}
                />
              </div>
              <Button
                onClick={async () => {
                  await createFinalReport(client.id, {
                    programId: client.programId ?? "",
                    startDate: client.createdAt,
                    endDate: new Date().toISOString(),
                    originalNeed: client.intake.assistanceRequested,
                    supportProvided: program?.name ?? "",
                    fundingProvided: terms[0] ? `$${terms[0].fundingAmount.toLocaleString()}` : "—",
                    milestonesCompleted: terms[0]?.milestones ?? "—",
                    resultsAchieved: report.resultsAchieved,
                    issuesEncountered: "None recorded",
                    staffComments: report.staffComments,
                    clientOutcome: report.clientOutcome,
                    recommendedNextSteps: "Review for future programs",
                    archiveDecision: report.archiveDecision,
                  });
                  toast.success("Final report saved");
                }}
              >
                Save final report
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="activity" className="mt-4 space-y-3">
          {logs.map((a) => (
            <div key={a.id} className="rounded-lg border border-border p-4">
              <p className="text-sm font-medium">{a.action}</p>
              <p className="text-sm text-muted-foreground">{a.description}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {a.user} · {new Date(a.timestamp).toLocaleString()}
              </p>
            </div>
          ))}
        </TabsContent>
      </Tabs>

      <SendFormDialog client={client} open={sendOpen} onOpenChange={setSendOpen} />
      <TermsDialog client={client} open={termsOpen} onOpenChange={setTermsOpen} />
    </div>
  );
}
