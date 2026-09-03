import { useEffect, useState } from "react";
import { listMembers } from "@/lib/apiClient";
import { useAppState } from "@/lib/store";
import type { OrgMember } from "@/types";

export function memberName(member: Pick<OrgMember, "email" | "firstName" | "lastName">): string {
  return [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email;
}

export function memberOptionLabel(member: OrgMember): string {
  const name = memberName(member);
  return member.jobTitle ? `${name} · ${member.jobTitle}` : name;
}

export function useOrganizationMembers() {
  const { authenticatedAdmin } = useAppState();
  const organizationId = authenticatedAdmin?.organizationId;
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!organizationId) {
      setMembers([]);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void listMembers(organizationId)
      .then((result) => {
        if (!cancelled) setMembers(result);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Unable to load staff.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  return {
    members,
    activeMembers: members.filter((member) => member.isActive && !member.invitePending),
    loading,
    error,
  };
}
