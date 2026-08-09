import { useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CheckCircle, FileText, Plus, Search, Send, User } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { useAppState } from "@/lib/store";
import { createClient, createFormAssignment } from "@/lib/api";
import { FormRendererDialog } from "@/components/dialogs/FormRendererDialog";
import {
  STAFF,
  type Client,
  type FormAssignment,
  type ProfileSource,
  type ProfileType,
  type RelationshipType,
} from "@/types";

export const Route = createFileRoute("/intake")({
  head: () => ({
    meta: [
      { title: "New intake — ClientFlow" },
      {
        name: "description",
        content:
          "Profile-first intake: search for an existing profile or create a new one, then choose a form.",
      },
      { property: "og:title", content: "New intake — ClientFlow" },
      {
        property: "og:description",
        content:
          "Profile-first intake: search for an existing profile or create a new one, then choose a form.",
      },
    ],
  }),
  component: IntakePage,
});

type IntakeStep =
  "search" | "select" | "create" | "choose-form" | "choose-method" | "configure-link" | "done";

const STEP_LABELS = ["Search", "Profile", "Form", "Deliver", "Confirm"] as const;
const stepProgress: Record<IntakeStep, number> = {
  search: 0,
  select: 0,
  create: 0,
  "choose-form": 1,
  "choose-method": 2,
  "configure-link": 3,
  done: 4,
};

function StepIndicator({ step }: { step: IntakeStep }) {
  const current = stepProgress[step];
  return (
    <div className="flex flex-wrap items-center gap-1">
      {STEP_LABELS.map((label, i) => (
        <div key={label} className="flex items-center gap-1">
          <span
            className={`flex size-6 items-center justify-center rounded-full text-xs font-semibold transition-colors ${i < current ? "bg-primary text-primary-foreground" : i === current ? "ring-primary bg-primary text-primary-foreground ring-2 ring-offset-2" : "bg-muted text-muted-foreground"}`}
          >
            {i < current ? <CheckCircle className="size-3.5" /> : i + 1}
          </span>
          <span className={`text-sm ${i === current ? "font-semibold" : "text-muted-foreground"}`}>
            {label}
          </span>
          {i < STEP_LABELS.length - 1 && <span className="mx-1 text-muted-foreground">›</span>}
        </div>
      ))}
    </div>
  );
}

function IntakePage() {
  const { clients, formTemplates, programs } = useAppState();
  const navigate = useNavigate();

  const [step, setStep] = useState<IntakeStep>("search");
  const [searchEmail, setSearchEmail] = useState("");
  const [searchPhone, setSearchPhone] = useState("");
  const [searchBusiness, setSearchBusiness] = useState("");
  const [searchResults, setSearchResults] = useState<Client[]>([]);
  const [searched, setSearched] = useState(false);
  const [selectedProfile, setSelectedProfile] = useState<Client | null>(null);
  const [newProfile, setNewProfile] = useState({
    primaryContactName: "",
    businessName: "",
    email: "",
    phone: "",
    website: "",
    profileType: "business" as ProfileType,
    relationshipType: "prospect" as RelationshipType,
    source: "admin_created" as ProfileSource,
    assignedStaff: STAFF[0],
  });
  const [selectedFormId, setSelectedFormId] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [dueDate, setDueDate] = useState(
    new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10),
  );
  const [assignedStaff, setAssignedStaff] = useState(STAFF[0]);
  const [personalMessage, setPersonalMessage] = useState("");
  const [fillingAssignment, setFillingAssignment] = useState<FormAssignment | null>(null);

  function handleSearch() {
    const em = searchEmail.toLowerCase().trim();
    const ph = searchPhone.replace(/\D/g, "");
    const biz = searchBusiness.toLowerCase().trim();
    if (!em && !ph && !biz) {
      toast.error("Enter at least one search term");
      return;
    }
    const results = clients.filter((c) => {
      if (em && c.email.toLowerCase().includes(em)) return true;
      if (ph && c.phone.replace(/\D/g, "").includes(ph)) return true;
      if (biz && c.businessName.toLowerCase().includes(biz)) return true;
      return false;
    });
    setSearchResults(results);
    setSearched(true);
    setStep("select");
  }

  function handleSelectProfile(client: Client) {
    setSelectedProfile(client);
    setRecipientEmail(client.email);
    setAssignedStaff(client.assignedStaff);
    setStep("choose-form");
  }

  async function handleCreateProfile() {
    if (!newProfile.primaryContactName || !newProfile.email) {
      toast.error("Contact name and email are required");
      return;
    }
    const created = await createClient({
      organizationId: "org_ea_management",
      businessName: newProfile.businessName || newProfile.primaryContactName,
      primaryContactName: newProfile.primaryContactName,
      email: newProfile.email,
      phone: newProfile.phone,
      website: newProfile.website,
      socialLinks: [],
      programId: null,
      status: "New Intake",
      profileType: newProfile.profileType,
      relationshipType: newProfile.relationshipType,
      lifecycleStatus: "new",
      assignedStaff: newProfile.assignedStaff,
      assignedUserId: null,
      intakeSource: newProfile.source,
      source: newProfile.source,
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
    setSelectedProfile(created);
    setRecipientEmail(created.email);
    setAssignedStaff(created.assignedStaff);
    toast.success("Profile created");
    setStep("choose-form");
  }

  async function handleFillOutNow() {
    if (!selectedProfile || !selectedFormId) return;
    const assignment = await createFormAssignment({
      clientId: selectedProfile.id,
      formId: selectedFormId,
      completionMethod: "admin_assisted",
      deliveryMethod: "none",
      recipientEmail: selectedProfile.email,
      assignedUserId: null,
      dueDate,
      status: "draft",
      organizationId: "org_ea_management",
      isDemo: selectedProfile.isDemo ?? false,
      createdByUserId: "user_alicia",
    });
    setFillingAssignment(assignment);
  }

  async function handleSendSecureLink() {
    if (!selectedProfile || !selectedFormId) return;
    if (!recipientEmail) {
      toast.error("Recipient email is required");
      return;
    }
    await createFormAssignment({
      clientId: selectedProfile.id,
      formId: selectedFormId,
      completionMethod: "secure_link",
      deliveryMethod: "email",
      recipientEmail,
      assignedUserId: null,
      dueDate,
      status: "sent",
      organizationId: "org_ea_management",
      isDemo: selectedProfile.isDemo ?? false,
      createdByUserId: "user_alicia",
      personalMessage,
    });
    toast.success(`Secure link sent to ${recipientEmail}`);
    setStep("done");
  }

  const templateName = (id: string) => formTemplates.find((t) => t.id === id)?.name ?? id;

  return (
    <div className="space-y-6">
      <PageHeader
        title="New Intake"
        description="Every person and business gets one persistent profile — reused for every form, contract, and record."
      />
      <StepIndicator step={step} />

      {/* SEARCH + SELECT */}
      {(step === "search" || step === "select") && (
        <Card className="shadow-card">
          <CardContent className="space-y-5 p-6">
            <div>
              <h3 className="font-display text-base font-semibold">
                Search for an existing profile
              </h3>
              <p className="text-sm text-muted-foreground">
                Enter any combination of email, phone, or business name.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label>Email</Label>
                <Input
                  placeholder="email@example.com"
                  value={searchEmail}
                  onChange={(e) => setSearchEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  placeholder="(555) 000-0000"
                  value={searchPhone}
                  onChange={(e) => setSearchPhone(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Business name</Label>
                <Input
                  placeholder="Business name"
                  value={searchBusiness}
                  onChange={(e) => setSearchBusiness(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                />
              </div>
            </div>
            <Button onClick={handleSearch}>
              <Search className="size-4" />
              Search profiles
            </Button>

            {searched && step === "select" && (
              <div className="space-y-3 border-t border-border pt-4">
                {searchResults.length > 0 ? (
                  <>
                    <p className="text-sm font-medium">
                      {searchResults.length} matching profile{searchResults.length !== 1 ? "s" : ""}{" "}
                      found
                    </p>
                    {searchResults.map((c) => (
                      <div
                        key={c.id}
                        className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-border p-4"
                      >
                        <div>
                          <p className="font-medium">{c.businessName}</p>
                          <p className="text-sm text-muted-foreground">
                            {c.primaryContactName} · {c.email} · {c.phone}
                          </p>
                          <div className="mt-1.5 flex flex-wrap gap-2">
                            {c.relationshipType && <StatusBadge status={c.relationshipType} />}
                            <StatusBadge status={c.status} />
                          </div>
                        </div>
                        <Button onClick={() => handleSelectProfile(c)}>Select profile</Button>
                      </div>
                    ))}
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">No existing profiles found.</p>
                )}
                <div className="rounded-xl border-2 border-dashed border-border p-4">
                  <p className="text-sm font-semibold">Create a new profile</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    No match found, or this person prefers a separate record.
                  </p>
                  <Button className="mt-3" variant="outline" onClick={() => setStep("create")}>
                    <Plus className="size-4" />
                    Create new profile
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* CREATE PROFILE */}
      {step === "create" && (
        <Card className="shadow-card">
          <CardContent className="space-y-5 p-6">
            <div>
              <h3 className="font-display text-base font-semibold">Create new profile</h3>
              <p className="text-sm text-muted-foreground">
                This profile is permanent — reused for every form, contract, and record.
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Contact name *</Label>
                <Input
                  value={newProfile.primaryContactName}
                  onChange={(e) =>
                    setNewProfile({ ...newProfile, primaryContactName: e.target.value })
                  }
                />
              </div>
              <div className="space-y-1.5">
                <Label>Business / Organization name</Label>
                <Input
                  value={newProfile.businessName}
                  onChange={(e) => setNewProfile({ ...newProfile, businessName: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Email *</Label>
                <Input
                  type="email"
                  value={newProfile.email}
                  onChange={(e) => setNewProfile({ ...newProfile, email: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input
                  value={newProfile.phone}
                  onChange={(e) => setNewProfile({ ...newProfile, phone: e.target.value })}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Profile type</Label>
                <Select
                  value={newProfile.profileType}
                  onValueChange={(v) =>
                    setNewProfile({ ...newProfile, profileType: v as ProfileType })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="individual">Individual</SelectItem>
                    <SelectItem value="business">Business</SelectItem>
                    <SelectItem value="organization">Organization</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Relationship type</Label>
                <Select
                  value={newProfile.relationshipType}
                  onValueChange={(v) =>
                    setNewProfile({ ...newProfile, relationshipType: v as RelationshipType })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="prospect">Prospect</SelectItem>
                    <SelectItem value="applicant">Applicant</SelectItem>
                    <SelectItem value="client">Client</SelectItem>
                    <SelectItem value="sponsor">Sponsor</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Source</Label>
                <Select
                  value={newProfile.source}
                  onValueChange={(v) =>
                    setNewProfile({ ...newProfile, source: v as ProfileSource })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin_created">Admin created</SelectItem>
                    <SelectItem value="referral">Referral</SelectItem>
                    <SelectItem value="public_form">Public form</SelectItem>
                    <SelectItem value="secure_invitation">Secure invitation</SelectItem>
                    <SelectItem value="imported">Imported</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Assigned staff</Label>
                <Select
                  value={newProfile.assignedStaff}
                  onValueChange={(v) => setNewProfile({ ...newProfile, assignedStaff: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAFF.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-3">
              <Button onClick={handleCreateProfile}>
                <User className="size-4" />
                Create profile
              </Button>
              <Button variant="outline" onClick={() => setStep("select")}>
                Back to search
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CHOOSE FORM */}
      {step === "choose-form" && selectedProfile && (
        <Card className="shadow-card">
          <CardContent className="space-y-5 p-6">
            <div>
              <h3 className="font-display text-base font-semibold">
                Choose a form for {selectedProfile.businessName}
              </h3>
              <p className="text-sm text-muted-foreground">
                {selectedProfile.primaryContactName} · {selectedProfile.email}
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {formTemplates.map((t) => {
                const prog = programs.find((p) => p.id === t.programId);
                return (
                  <button
                    key={t.id}
                    onClick={() => setSelectedFormId(t.id)}
                    className={`rounded-xl border p-4 text-left transition-colors ${selectedFormId === t.id ? "border-primary bg-primary/5" : "border-border bg-card hover:bg-muted"}`}
                  >
                    <p className="text-sm font-semibold">{t.name}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">{prog?.name ?? "—"}</p>
                    <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                      {t.description}
                    </p>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-3">
              <Button disabled={!selectedFormId} onClick={() => setStep("choose-method")}>
                <FileText className="size-4" />
                Continue
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep("select");
                  setSearched(false);
                }}
              >
                Change profile
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* CHOOSE METHOD */}
      {step === "choose-method" && selectedProfile && (
        <Card className="shadow-card">
          <CardContent className="space-y-5 p-6">
            <div>
              <h3 className="font-display text-base font-semibold">
                How would you like to complete this form?
              </h3>
              <p className="text-sm text-muted-foreground">
                Form: <span className="font-medium">{templateName(selectedFormId)}</span> · Profile:{" "}
                {selectedProfile.businessName}
              </p>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <button
                onClick={handleFillOutNow}
                className="rounded-xl border-2 border-border p-6 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <User className="size-6 text-primary" />
                <p className="mt-3 font-semibold">Fill Out Now</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Complete the form with the client during this session. Saves as a draft and
                  records the staff member.
                </p>
              </button>
              <button
                onClick={() => setStep("configure-link")}
                className="rounded-xl border-2 border-border p-6 text-left transition-colors hover:border-primary hover:bg-primary/5"
              >
                <Send className="size-6 text-primary" />
                <p className="mt-3 font-semibold">Send Secure Link</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Generate a secure, prefilled link and deliver it to the client to complete on
                  their own.
                </p>
              </button>
            </div>
            <Button variant="outline" onClick={() => setStep("choose-form")}>
              Back
            </Button>
          </CardContent>
        </Card>
      )}

      {/* CONFIGURE SECURE LINK */}
      {step === "configure-link" && selectedProfile && (
        <Card className="shadow-card">
          <CardContent className="space-y-5 p-6">
            <div>
              <h3 className="font-display text-base font-semibold">
                Configure secure link delivery
              </h3>
              <p className="text-sm text-muted-foreground">
                Form: <span className="font-medium">{templateName(selectedFormId)}</span> · Profile:{" "}
                {selectedProfile.businessName}
              </p>
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
                <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label>Assigned staff member</Label>
                <Select value={assignedStaff} onValueChange={setAssignedStaff}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {STAFF.map((s) => (
                      <SelectItem key={s} value={s}>
                        {s}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label>Delivery method</Label>
                <div className="space-y-2 pt-1">
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input
                      type="radio"
                      name="delivery"
                      value="email"
                      defaultChecked
                      className="size-4"
                    />
                    Email
                  </label>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="radio" disabled className="size-4" />
                    SMS{" "}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Coming soon</span>
                  </label>
                  <label className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="radio" disabled className="size-4" />
                    Email &amp; SMS{" "}
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs">Coming soon</span>
                  </label>
                </div>
              </div>
            </div>
            <div className="space-y-1.5">
              <Label>Personal message (optional)</Label>
              <Textarea
                rows={3}
                placeholder="Add a personal note to include in the email…"
                value={personalMessage}
                onChange={(e) => setPersonalMessage(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <Button onClick={handleSendSecureLink}>
                <Send className="size-4" />
                Send secure link
              </Button>
              <Button variant="outline" onClick={() => setStep("choose-method")}>
                Back
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* DONE */}
      {step === "done" && selectedProfile && (
        <Card className="shadow-card">
          <CardContent className="space-y-4 p-6 text-center">
            <CheckCircle className="mx-auto size-10 text-primary" />
            <h3 className="font-display text-base font-semibold">Intake complete</h3>
            <p className="text-sm text-muted-foreground">
              The form assignment has been created and is visible in the profile's Forms tab.
            </p>
            <div className="flex justify-center gap-3">
              <Button
                onClick={() =>
                  navigate({ to: "/clients/$clientId", params: { clientId: selectedProfile.id } })
                }
              >
                View profile
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setStep("search");
                  setSearched(false);
                  setSearchEmail("");
                  setSearchPhone("");
                  setSearchBusiness("");
                  setSearchResults([]);
                  setSelectedProfile(null);
                  setSelectedFormId("");
                  setPersonalMessage("");
                }}
              >
                Start another intake
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {selectedProfile && (
        <FormRendererDialog
          key={fillingAssignment?.id ?? "none"}
          assignment={fillingAssignment}
          client={selectedProfile}
          open={!!fillingAssignment}
          onOpenChange={(v) => {
            if (!v) {
              setFillingAssignment(null);
              navigate({ to: "/clients/$clientId", params: { clientId: selectedProfile.id } });
            }
          }}
        />
      )}
    </div>
  );
}
