import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
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
import { RepeatableSocialLinksInput } from "@/components/SocialMediaInput";
import { updateClient } from "@/lib/api";
import { changedFields } from "@/lib/changed-fields";
import { toExternalUrl } from "@/lib/external-links";
import { invalidSocialLinks } from "@/lib/social-platforms";
import {
  memberName,
  memberOptionLabel,
  useOrganizationMembers,
} from "@/hooks/use-organization-members";
import {
  CLIENT_STATUSES,
  type Client,
  type ClientStatus,
  type ProfileType,
  type RelationshipType,
} from "@/types";

const PROFILE_TYPES: { value: ProfileType; label: string }[] = [
  { value: "individual", label: "Individual" },
  { value: "business", label: "Business" },
  { value: "organization", label: "Organization" },
];

const RELATIONSHIP_TYPES: { value: RelationshipType; label: string }[] = [
  { value: "prospect", label: "Prospect" },
  { value: "applicant", label: "Applicant" },
  { value: "client", label: "Client" },
  { value: "sponsor", label: "Sponsor" },
];

function dateInputValue(value?: string) {
  return value ? value.slice(0, 10) : "";
}

export function EditClientDialog({
  client,
  open,
  onOpenChange,
}: {
  client: Client;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [businessName, setBusinessName] = useState("");
  const [primaryContactName, setPrimaryContactName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [socialLinks, setSocialLinks] = useState<string[]>([]);
  const [profileType, setProfileType] = useState<ProfileType>("business");
  const [relationshipType, setRelationshipType] = useState<RelationshipType>("prospect");
  const [status, setStatus] = useState<ClientStatus>("New Intake");
  const { activeMembers } = useOrganizationMembers();
  const [assignedUserId, setAssignedUserId] = useState("__unassigned");
  const [nextFollowUpDate, setNextFollowUpDate] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setBusinessName(client.businessName);
    setPrimaryContactName(client.primaryContactName);
    setEmail(client.email);
    setPhone(client.phone);
    setWebsite(client.website ?? "");
    setSocialLinks(client.socialLinks ?? []);
    setProfileType(client.profileType ?? "business");
    setRelationshipType(client.relationshipType ?? "prospect");
    setStatus(client.status);
    setAssignedUserId(
      client.assignedUserId ?? (client.assignedStaff ? "__legacy" : "__unassigned"),
    );
    setNextFollowUpDate(dateInputValue(client.nextFollowUpDate));
  }, [client, open]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!businessName.trim() || !primaryContactName.trim() || !email.trim()) {
      toast.error("Business name, contact name, and email are required.");
      return;
    }
    const selectedMember = activeMembers.find((member) => member.id === assignedUserId);
    const next: Record<string, unknown> = {
      businessName: businessName.trim(),
      primaryContactName: primaryContactName.trim(),
      email: email.trim(),
      phone: phone.trim(),
      website: website.trim(),
      socialLinks,
      profileType,
      relationshipType,
      status,
      assignedUserId:
        assignedUserId === "__legacy" ? client.assignedUserId : (selectedMember?.id ?? null),
      assignedStaff:
        assignedUserId === "__legacy"
          ? client.assignedStaff
          : selectedMember
            ? memberName(selectedMember)
            : "",
      nextFollowUpDate,
    };
    // Only what staff changed is sent: re-sending untouched values (a status the workflow set, an
    // old social handle) must never be what blocks a save.
    const changes = changedFields(next, {
      businessName: client.businessName,
      primaryContactName: client.primaryContactName,
      email: client.email,
      phone: client.phone ?? "",
      website: client.website ?? "",
      socialLinks: client.socialLinks ?? [],
      profileType: client.profileType ?? "business",
      relationshipType: client.relationshipType ?? "prospect",
      status: client.status,
      assignedUserId: client.assignedUserId ?? null,
      assignedStaff: client.assignedStaff ?? "",
      nextFollowUpDate: dateInputValue(client.nextFollowUpDate),
    });
    if (Object.keys(changes).length === 0) {
      onOpenChange(false);
      return;
    }
    if ("website" in changes && website.trim() && !toExternalUrl(website)) {
      toast.error("The website isn't a web address. Enter something like eabakery.com.");
      return;
    }
    if ("socialLinks" in changes && invalidSocialLinks(socialLinks).length > 0) {
      toast.error(
        "Fix the social media links: choose the site for each one or paste the full link.",
      );
      return;
    }

    setSaving(true);
    try {
      await updateClient(client.id, changes as Partial<Client>);
      toast.success("Client updated.");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to update client.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle className="font-display">Edit client</DialogTitle>
        </DialogHeader>

        <form id="edit-client-form" onSubmit={handleSubmit} className="space-y-5 py-2">
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="client-business-name">Business / organization name *</Label>
              <Input
                id="client-business-name"
                value={businessName}
                onChange={(event) => setBusinessName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-contact-name">Primary contact name *</Label>
              <Input
                id="client-contact-name"
                value={primaryContactName}
                onChange={(event) => setPrimaryContactName(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-email">Email *</Label>
              <Input
                id="client-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="client-phone">Phone</Label>
              <Input
                id="client-phone"
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="client-website">Website</Label>
              <Input
                id="client-website"
                type="text"
                inputMode="url"
                autoCapitalize="none"
                spellCheck={false}
                value={website}
                onChange={(event) => setWebsite(event.target.value)}
                placeholder="eabakery.com"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="client-social-links">Social media</Label>
              <RepeatableSocialLinksInput
                inputId="client-social-links"
                value={socialLinks}
                onChange={setSocialLinks}
              />
            </div>
            <div className="space-y-1.5">
              <Label>Profile type</Label>
              <Select
                value={profileType}
                onValueChange={(value) => setProfileType(value as ProfileType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROFILE_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Relationship type</Label>
              <Select
                value={relationshipType}
                onValueChange={(value) => setRelationshipType(value as RelationshipType)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {RELATIONSHIP_TYPES.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Status</Label>
              <Select value={status} onValueChange={(value) => setStatus(value as ClientStatus)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {!CLIENT_STATUSES.includes(client.status) && (
                    <SelectItem value={client.status}>
                      {client.status} (set by the workflow)
                    </SelectItem>
                  )}
                  {CLIENT_STATUSES.map((clientStatus) => (
                    <SelectItem key={clientStatus} value={clientStatus}>
                      {clientStatus}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Assigned staff</Label>
              <Select value={assignedUserId} onValueChange={setAssignedUserId}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__unassigned">Unassigned</SelectItem>
                  {client.assignedStaff && !client.assignedUserId && (
                    <SelectItem value="__legacy">
                      {client.assignedStaff} · Legacy assignment
                    </SelectItem>
                  )}
                  {activeMembers.map((member) => (
                    <SelectItem key={member.id} value={member.id}>
                      {memberOptionLabel(member)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="client-next-follow-up">Next follow-up</Label>
              <Input
                id="client-next-follow-up"
                type="date"
                value={nextFollowUpDate}
                onChange={(event) => setNextFollowUpDate(event.target.value)}
              />
            </div>
          </div>
        </form>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button type="submit" form="edit-client-form" disabled={saving}>
            {saving ? "Saving..." : "Save changes"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
