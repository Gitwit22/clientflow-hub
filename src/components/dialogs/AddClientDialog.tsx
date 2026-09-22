import { useState, type FormEvent } from "react";
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
import { acfCreateClient } from "@/lib/apiClient";
import { refreshClientProfile } from "@/lib/api";
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
  const [contactName, setContactName] = useState("");
  const [businessName, setBusinessName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [sendIntakeImmediately, setSendIntakeImmediately] = useState(true);
  const [saving, setSaving] = useState(false);

  function reset() {
    setContactName("");
    setBusinessName("");
    setEmail("");
    setPhone("");
    setSendIntakeImmediately(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
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
      });
      try {
        await refreshClientProfile(result.client.id);
      } catch (refreshError) {
        console.warn("Client was created but the client list could not be refreshed.", refreshError);
      }
      const { emailDelivery } = result;
      if (emailDelivery.status === "sent") {
        toast.success("Client added. General Intake email sent.");
      } else if (emailDelivery.status === "deferred") {
        toast.success("Client added. Intake email is saved as deferred — send it when ready.");
      } else {
        toast.error(
          `Client added, but the intake email was not sent (${emailDelivery.reason ?? emailDelivery.status}). You can resend it from the client profile.`,
        );
      }
      reset();
      onOpenChange(false);
      onCreated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to add client.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
              onChange={(event) => setEmail(event.target.value)}
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
              Send the General Intake email immediately. Uncheck to review and send it manually
              from the client profile later.
            </Label>
          </div>
        </form>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" form="add-client-form" disabled={saving}>
            {saving ? "Adding…" : "Add client"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
