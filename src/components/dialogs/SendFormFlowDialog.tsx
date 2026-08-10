import { useState, useMemo, useEffect } from "react";
import { Link } from "@tanstack/react-router";
import { CheckCircle, Plus, Search, Send, User } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { StatusBadge } from "@/components/StatusBadge";
import { createClient, createFormAssignment, renderEmailBody, sendFormEmail } from "@/lib/api";
import { useAppState } from "@/lib/store";
import { STAFF, type Client } from "@/types";

type FlowStep = "profile" | "form" | "send" | "done";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  /** Pre-select a form template — skips the form selection step. */
  preselectedTemplateId?: string;
  /** Pre-select a client — skips the profile search/create step. */
  preselectedClient?: Client;
}

export function SendFormFlowDialog({
  open,
  onOpenChange,
  preselectedTemplateId,
  preselectedClient,
}: Props) {
  const { clients, formTemplates, programs } = useAppState();

  function initStep(): FlowStep {
    if (preselectedClient) return preselectedTemplateId ? "send" : "form";
    return "profile";
  }

  const [step, setStep] = useState<FlowStep>(initStep);

  // Profile step
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Client[]>([]);
  const [searched, setSearched] = useState(false);
  const [quickName, setQuickName] = useState("");
  const [quickEmail, setQuickEmail] = useState("");
  const [selectedClient, setSelectedClient] = useState<Client | null>(preselectedClient ?? null);

  // Form step
  const [selectedFormId, setSelectedFormId] = useState(preselectedTemplateId ?? "");

  // Send step
  const [recipientEmail, setRecipientEmail] = useState(preselectedClient?.email ?? "");
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
  );
  const [personalMessage, setPersonalMessage] = useState("");
  const [bodyOverride, setBodyOverride] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);

  // Reset state every time the dialog opens
  useEffect(() => {
    if (!open) return;
    setStep(initStep());
    setSearchQuery("");
    setSearchResults([]);
    setSearched(false);
    setQuickName("");
    setQuickEmail("");
    setSelectedClient(preselectedClient ?? null);
    setSelectedFormId(preselectedTemplateId ?? "");
    setRecipientEmail(preselectedClient?.email ?? "");
    setDueDate(new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10));
    setPersonalMessage("");
    setBodyOverride(null);
    setIsSending(false);
  }, [open]);

  const template = formTemplates.find((t) => t.id === selectedFormId);
  const program = programs.find((p) => p.id === template?.programId);

  const emailBody = useMemo(
    () =>
      renderEmailBody({
        contactName: selectedClient?.primaryContactName ?? "{{contactName}}",
        programName: program?.name ?? "{{programName}}",
        dueDate,
        secureFormLink: `${typeof window !== "undefined" ? window.location.origin : ""}/s/{{generated}}`,
      }),
    [selectedClient, program, dueDate],
  );

  // Step indicator config
  const STEPS = preselectedClient
    ? preselectedTemplateId
      ? (["Send"] as const)
      : (["Form", "Send"] as const)
    : preselectedTemplateId
      ? (["Profile", "Send"] as const)
      : (["Profile", "Form", "Send"] as const);

  const stepIdx =
    step === "profile" ? 0
    : step === "form" ? (preselectedClient ? 0 : 1)
    : step === "send" ? STEPS.length - 1
    : STEPS.length;

  // ── Handlers ──────────────────────────────────────────────────────────────

  function handleSearch() {
    const q = searchQuery.toLowerCase().trim();
    if (!q) {
      toast.error("Enter a name, email, phone, or business to search");
      return;
    }
    const results = clients.filter(
      (c) =>
        c.email.toLowerCase().includes(q) ||
        c.phone.replace(/\D/g, "").includes(q.replace(/\D/g, "")) ||
        c.businessName.toLowerCase().includes(q) ||
        c.primaryContactName.toLowerCase().includes(q),
    );
    setSearchResults(results);
    setSearched(true);
  }

  function handlePickClient(client: Client) {
    setSelectedClient(client);
    setRecipientEmail(client.email);
    setStep(selectedFormId ? "send" : "form");
  }

  async function handleQuickCreate() {
    if (!quickName.trim() || !quickEmail.trim()) {
      toast.error("Name and email are required");
      return;
    }
    const created = await createClient({
      organizationId: "org_ea_management",
      businessName: quickName.trim(),
      primaryContactName: quickName.trim(),
      email: quickEmail.trim(),
      phone: "",
      website: "",
      socialLinks: [],
      programId: null,
      status: "New Intake",
      profileType: "individual",
      relationshipType: "prospect",
      lifecycleStatus: "new",
      assignedStaff: STAFF[0],
      assignedUserId: null,
      intakeSource: "admin_created",
      source: "admin_created",
      nextFollowUpDate: new Date(Date.now() + 3 * 864e5).toISOString(),
      isDemo: false,
      intake: {
        businessDescription: "",
        assistanceRequested: "",
        programOfInterest: "",
        budgetNeed: "",
        preferredContact: "Email",
        heardAboutUs: "",
        additionalComments: "",
        uploadedFiles: [],
      },
    });
    setSelectedClient(created);
    setRecipientEmail(created.email);
    toast.success("Profile created");
    setStep(selectedFormId ? "send" : "form");
  }

  async function handleSend() {
    if (!selectedClient || !selectedFormId || !recipientEmail) return;
    setIsSending(true);
    try {
      const assignment = await createFormAssignment({
        clientId: selectedClient.id,
        formId: selectedFormId,
        completionMethod: "secure_link",
        deliveryMethod: "email",
        recipientEmail,
        assignedUserId: null,
        dueDate: new Date(dueDate).toISOString(),
        status: "sent",
        organizationId: "org_ea_management",
        isDemo: selectedClient.isDemo ?? false,
        createdByUserId: "user_alicia",
        personalMessage: personalMessage || undefined,
      });
      await sendFormEmail(assignment.id, personalMessage || undefined);
      toast.success(`Form sent to ${recipientEmail}`);
      setStep("done");
    } finally {
      setIsSending(false);
    }
  }

  function handleSendAnother() {
    setStep("profile");
    setSelectedClient(preselectedClient ?? null);
    setSelectedFormId(preselectedTemplateId ?? "");
    setSearchQuery("");
    setSearchResults([]);
    setSearched(false);
    setQuickName("");
    setQuickEmail("");
    setRecipientEmail(preselectedClient?.email ?? "");
    setPersonalMessage("");
    setBodyOverride(null);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Send a form</DialogTitle>
          <DialogDescription>
            {step === "profile" && "Find an existing profile or create a new one to continue."}
            {step === "form" &&
              `Choose a form for ${selectedClient?.businessName ?? "this profile"}.`}
            {step === "send" && "Review and send the secure form link by email."}
            {step === "done" && "The secure link is on its way."}
          </DialogDescription>
        </DialogHeader>

        {/* Step indicator */}
        {step !== "done" && STEPS.length > 1 && (
          <div className="flex items-center gap-2 pb-1">
            {(STEPS as readonly string[]).map((label, i) => (
              <div key={label} className="flex items-center gap-1.5">
                <span
                  className={`flex size-5 items-center justify-center rounded-full font-mono text-[10px] font-semibold ${
                    i < stepIdx
                      ? "bg-primary text-primary-foreground"
                      : i === stepIdx
                        ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-1"
                        : "bg-muted text-muted-foreground"
                  }`}
                >
                  {i < stepIdx ? <CheckCircle className="size-3" /> : i + 1}
                </span>
                <span
                  className={`font-mono text-[10.5px] uppercase tracking-wide ${
                    i === stepIdx ? "font-semibold text-foreground" : "text-muted-foreground"
                  }`}
                >
                  {label}
                </span>
                {i < STEPS.length - 1 && (
                  <span className="text-xs text-muted-foreground">›</span>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── PROFILE STEP ── */}
        {step === "profile" && (
          <div className="space-y-5">
            {/* Search existing */}
            <div className="space-y-3">
              <p className="text-sm font-semibold">Search existing profiles</p>
              <div className="flex gap-2">
                <Input
                  placeholder="Name, email, phone, or business…"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="flex-1"
                />
                <Button variant="outline" onClick={handleSearch}>
                  <Search className="size-4" />
                </Button>
              </div>

              {searched && (
                <div className="max-h-52 space-y-2 overflow-y-auto">
                  {searchResults.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No matching profiles found.</p>
                  ) : (
                    searchResults.map((c) => (
                      <div
                        key={c.id}
                        className="flex items-center justify-between gap-3 rounded-lg border border-border p-3"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">{c.businessName}</p>
                          <p className="truncate text-xs text-muted-foreground">
                            {c.primaryContactName} · {c.email}
                          </p>
                          <div className="mt-1 flex flex-wrap gap-1.5">
                            <StatusBadge status={c.status} />
                          </div>
                        </div>
                        <Button size="sm" onClick={() => handlePickClient(c)}>
                          Select
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

            {/* Divider */}
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t border-border" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-background px-2 text-muted-foreground">
                  or start a new profile
                </span>
              </div>
            </div>

            {/* Quick-create */}
            <div className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label>Name *</Label>
                  <Input
                    placeholder="Full name"
                    value={quickName}
                    onChange={(e) => setQuickName(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label>Email *</Label>
                  <Input
                    type="email"
                    placeholder="email@example.com"
                    value={quickEmail}
                    onChange={(e) => setQuickEmail(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && handleQuickCreate()}
                  />
                </div>
              </div>
              <Button
                onClick={handleQuickCreate}
                disabled={!quickName.trim() || !quickEmail.trim()}
              >
                <User className="size-4" />
                Create profile & continue
              </Button>
            </div>
          </div>
        )}

        {/* ── FORM STEP ── */}
        {step === "form" && (
          <div className="space-y-4">
            <div className="grid max-h-[52vh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
              {formTemplates.map((t) => {
                const prog = programs.find((p) => p.id === t.programId);
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedFormId(t.id)}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      selectedFormId === t.id
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:bg-muted"
                    }`}
                  >
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{prog?.name ?? "—"}</p>
                    <p className="mt-1.5 line-clamp-2 text-xs text-muted-foreground">
                      {t.description}
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3">
              <Button disabled={!selectedFormId} onClick={() => setStep("send")}>
                <Send className="size-4" />
                Continue
              </Button>
              {!preselectedClient && (
                <Button variant="outline" onClick={() => setStep("profile")}>
                  Back
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── SEND STEP ── */}
        {step === "send" && selectedClient && (
          <div className="space-y-4">
            {/* Summary pill */}
            <div className="rounded-xl border border-border bg-muted/50 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Sending to
              </p>
              <p className="mt-1 text-sm font-medium">{selectedClient.businessName}</p>
              <p className="text-xs text-muted-foreground">
                {selectedClient.primaryContactName} · {selectedClient.email}
              </p>
              {template && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Form:{" "}
                  <span className="font-medium text-foreground">{template.name}</span>
                </p>
              )}
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Recipient email</Label>
                <Input
                  type="email"
                  value={recipientEmail}
                  onChange={(e) => setRecipientEmail(e.target.value)}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Due date</Label>
                <Input
                  type="date"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label>
                Personal message{" "}
                <span className="text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                rows={2}
                placeholder="Add a personal note to the email…"
                value={personalMessage}
                onChange={(e) => setPersonalMessage(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Email body preview</Label>
              <Textarea
                rows={9}
                value={bodyOverride ?? emailBody}
                onChange={(e) => setBodyOverride(e.target.value)}
                className="font-mono text-xs"
              />
            </div>

            <div className="flex gap-3">
              <Button
                onClick={handleSend}
                disabled={isSending || !recipientEmail || !selectedFormId}
              >
                <Send className="size-4" />
                {isSending ? "Sending…" : "Send form"}
              </Button>
              {!preselectedClient && (
                <Button
                  variant="outline"
                  onClick={() => setStep(preselectedTemplateId ? "profile" : "form")}
                >
                  Back
                </Button>
              )}
            </div>
          </div>
        )}

        {/* ── DONE STEP ── */}
        {step === "done" && selectedClient && (
          <div className="space-y-4 py-4 text-center">
            <CheckCircle className="mx-auto size-10 text-primary" />
            <div>
              <p className="font-semibold">Form sent to {recipientEmail}</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {selectedClient.businessName} has been saved and the secure link is on its way.
              </p>
            </div>
            <div className="flex justify-center gap-3 pt-1">
              <Button asChild variant="outline">
                <Link to="/clients/$clientId" params={{ clientId: selectedClient.id }}>
                  View profile
                </Link>
              </Button>
              <Button variant="outline" onClick={handleSendAnother}>
                Send another
              </Button>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
