import { useState, type FormEvent } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { acfCreateClient, acfFindClientsByEmail, type ClientEmailMatch } from "@/lib/apiClient";
import { refreshClientProfile, restoreClient } from "@/lib/api";
import { describeDeliveryReason } from "@/lib/client-send";
import { useAppState } from "@/lib/store";

export function AddClientDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: () => void;
}) {
  const { authenticatedAdmin } = useAppState();
  const navigate = useNavigate();
  const [contactName, setContactName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sendIntakeImmediately, setSendIntakeImmediately] = useState(true);
  const [isTest, setIsTest] = useState(false);
  const [saving, setSaving] = useState(false);
  /** Clients that already use this email; shown once before creating so staff can restore instead. */
  const [matches, setMatches] = useState<ClientEmailMatch[] | null>(null);

  function reset() {
    setContactName("");
    setBusinessName("");
    setEmail("");
    setPhone("");
    setSendIntakeImmediately(true);
    setIsTest(false);
    setMatches(null);
  }

  function close() {
    reset();
    onOpenChange(false);
  }

  function openProfile(clientId: string) {
    close();
    void navigate({ to: "/clients/$clientId", params: { clientId } });
  }

  async function handleRestore(match: ClientEmailMatch) {
    setSaving(true);
    try {
      await restoreClient(match.id);
      toast.success(`${match.businessName || match.contactName} restored with their history.`);
      openProfile(match.id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to restore client.");
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (matches === null) {
      if (!contactName.trim() || !email.trim()) {
        toast.error("Contact name and email are required.");
        return;
      }
      // The check only offers a choice; if it can't run, adding the client still works.
      setSaving(true);
      try {
        const found = (await acfFindClientsByEmail(email.trim())).matches;
        if (found.length) {
          setMatches(found);
          setSaving(false);
          return;
        }
      } catch (error) {
        console.warn("Could not check for an existing client with this email.", error);
      }
      setSaving(false);
    }
    await createClient();
  }

  async function createClient() {
    const organizationId = authenticatedAdmin?.organizationId;
    if (!organizationId) {
      toast.error("No active organization for this session.");
      return;
    }
    if (!contactName.trim() || !email.trim()) {
      toast.error("Contact name and email are required.");
      return;
    }

    setSaving(true);
    try {
      const result = await acfCreateClient({
        organizationId,
        contactName: contactName.trim(),
        businessName: businessName.trim() || undefined,
        email: email.trim(),
        phone: phone.trim() || undefined,
        sendIntakeImmediately,
        ...(isTest ? { isTest: true } : {}),
      });
      try {
        await refreshClientProfile(result.client.id);
      } catch (refreshError) {
        console.warn(
          "Client was created but the client list could not be refreshed.",
          refreshError,
        );
      }
      const { emailDelivery } = result;
      const added = isTest ? "Test client added" : "Client added";
      if (emailDelivery.status === "sent") {
        toast.success(`${added}. General Intake email sent.`);
      } else if (emailDelivery.status === "deferred") {
        toast.success(`${added}. Intake email is saved as deferred — send it when ready.`);
      } else {
        toast.error(
          `${added}, but the intake email was not sent (${emailDelivery.reason ? describeDeliveryReason(emailDelivery.reason) : emailDelivery.status}). You can resend it from the client profile.`,
        );
      }
      close();
      onCreated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add client.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setMatches(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-display">Add client</DialogTitle>
          <DialogDescription>
            The General Intake form is created automatically and, once submitted, drives program
            selection and contract routing on its own.
          </DialogDescription>
        </DialogHeader>

        <form id="add-client-form" onSubmit={handleSubmit} className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="add-client-contact-name">Contact name *</Label>
            <Input
              id="add-client-contact-name"
              value={contactName}
              onChange={(event) => setContactName(event.target.value)}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-client-business-name">Business name</Label>
            <Input
              id="add-client-business-name"
              value={businessName}
              onChange={(event) => setBusinessName(event.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-client-email">Email *</Label>
            <Input
              id="add-client-email"
              type="email"
              value={email}
              onChange={(event) => {
                setEmail(event.target.value);
                setMatches(null);
              }}
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="add-client-phone">Phone</Label>
            <Input
              id="add-client-phone"
              type="tel"
              value={phone}
              onChange={(event) => setPhone(event.target.value)}
            />
          </div>
          <div className="flex items-start gap-2 rounded-md border border-border p-3">
            <Checkbox
              id="add-client-send-intake"
              checked={sendIntakeImmediately}
              onCheckedChange={(checked) => setSendIntakeImmediately(checked === true)}
            />
            <Label htmlFor="add-client-send-intake" className="text-sm font-normal leading-snug">
              Send the General Intake email immediately. Uncheck to review and send it manually from
              the client profile later.
            </Label>
          </div>
          <div className="flex items-start gap-2 rounded-md border border-border p-3">
            <Checkbox
              id="add-client-is-test"
              checked={isTest}
              onCheckedChange={(checked) => setIsTest(checked === true)}
            />
            <Label htmlFor="add-client-is-test" className="text-sm font-normal leading-snug">
              <span className="font-medium">This is a test client.</span> Try every step (awards,
              contracts, payments, emails) without changing your counts or reports, then delete it
              with everything it recorded. Emails really send, so use your own address. This can't
              be changed later.
            </Label>
          </div>
          {matches?.length ? (
            <div
              role="alert"
              className="space-y-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm dark:border-amber-700 dark:bg-amber-950/40"
            >
              <p className="font-medium">
                {matches.some((match) => match.isArchived)
                  ? "An archived client already uses this email."
                  : "A client already uses this email."}
              </p>
              <ul className="space-y-2">
                {matches.map((match) => (
                  <li key={match.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span>
                      {match.businessName || match.contactName}
                      {match.contactName &&
                      match.businessName &&
                      match.contactName !== match.businessName
                        ? ` (${match.contactName})`
                        : ""}
                      {match.isArchived ? " · archived" : ""}
                      {match.isTest ? " · test" : ""}
                    </span>
                    {match.isArchived ? (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => void handleRestore(match)}
                        disabled={saving}
                      >
                        Restore that profile
                      </Button>
                    ) : (
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openProfile(match.id)}
                        disabled={saving}
                      >
                        Open existing
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
              <p className="text-muted-foreground">
                Restoring brings back their profile, programs and history. Or add a separate new
                client with the same email.
              </p>
            </div>
          ) : null}
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={close} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="add-client-form" disabled={saving}>
            {saving
              ? "Adding…"
              : matches?.length
                ? "Create new anyway"
                : isTest
                  ? "Add test client"
                  : "Add client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
