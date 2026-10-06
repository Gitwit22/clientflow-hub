import { CopyLinkDialog } from "@/components/dialogs/CopyLinkDialog";
import { useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
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
import { ApiError, inviteMember, type StaffEmailDelivery } from "@/lib/apiClient";

const ROLE_OPTIONS = [
  { label: "Admin", value: "org_admin" },
  { label: "Staff", value: "reviewer" },
] as const;

interface InviteUserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  onSuccess: () => void;
}

export function InviteUserDialog({
  open,
  onOpenChange,
  organizationId,
  onSuccess,
}: InviteUserDialogProps) {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [roleLabel, setRoleLabel] = useState<string>("Staff");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [invite, setInvite] = useState<{
    email: string;
    link: string;
    hours: number;
    emailDelivery?: StaffEmailDelivery;
  } | null>(null);

  function reset() {
    setFirstName("");
    setLastName("");
    setEmail("");
    setRoleLabel("Staff");
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setIsSubmitting(true);
    const backendRole = roleLabel === "Admin" ? "org_admin" : "reviewer";
    try {
      const result = await inviteMember(organizationId, {
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim() || undefined,
        role: backendRole,
      });
      setInvite({
        email: email.trim(),
        link: result.inviteUrl,
        hours: result.expiresInHours ?? 72,
        emailDelivery: result.emailDelivery,
      });
      reset();
      onOpenChange(false);
      onSuccess();
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.message : "Failed to send invitation. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      {invite && (
        <CopyLinkDialog
          open
          onOpenChange={(value) => !value && setInvite(null)}
          title={
            invite.emailDelivery?.status === "sent" ? "Invitation sent" : "Send this sign-up link"
          }
          description={`With this link ${invite.email} sets their password and joins. It works for ${invite.hours} hours.`}
          link={invite.link}
          recipientEmail={invite.email}
          emailDelivery={invite.emailDelivery}
        />
      )}
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (!v) reset();
          onOpenChange(v);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-display">Invite team member</DialogTitle>
            <DialogDescription>
              We'll email them a sign-up link (you can copy it too). It works for 72 hours.
            </DialogDescription>
          </DialogHeader>
          <form id="invite-form" onSubmit={handleSubmit} className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="inv-first">First name *</Label>
                <Input
                  id="inv-first"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  placeholder="Jane"
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="inv-last">Last name</Label>
                <Input
                  id="inv-last"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Smith"
                />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-email">Email *</Label>
              <Input
                id="inv-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-role">Role</Label>
              <Select value={roleLabel} onValueChange={setRoleLabel}>
                <SelectTrigger id="inv-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLE_OPTIONS.map((r) => (
                    <SelectItem key={r.label} value={r.label}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </form>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                reset();
                onOpenChange(false);
              }}
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button type="submit" form="invite-form" disabled={isSubmitting}>
              {isSubmitting ? "Sending…" : "Send invitation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
