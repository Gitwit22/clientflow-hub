import { useEffect, useState } from "react";
import { listMembers } from "@/lib/apiClient";
import { useAppState } from "@/lib/store";
import type { OrgMember } from "@/types";

export function memberName(member: Pick<OrgMember, "email" | "firstName" | "lastName">): string {
  return [member.firstName, member.lastName].filter(Boolean).join(" ") || member.email;
}

export function resolveMemberName(
  members: OrgMember[],
  userId?: string | null,
  fallback = "Unknown user",
): string {
  const member = userId ? members.find((candidate) => candidate.id === userId) : undefined;
  return member ? memberName(member) : fallback;
}

export function memberOptionLabel(member: OrgMember): string {
  const name = memberName(member);
  return member.jobTitle ? `${name} · ${member.jobTitle}` : name;
}

const MEMBERS_CHANGED = "clientflow:members-changed";

/** Call after inviting, re-roling or removing staff so every open staff list reloads. */
export function notifyMembersChanged(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(MEMBERS_CHANGED));
}

export function useOrganizationMembers() {
  const { authenticatedAdmin } = useAppState();
  const organizationId = authenticatedAdmin?.organizationId;
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    const reload = () => setVersion((current) => current + 1);
    window.addEventListener(MEMBERS_CHANGED, reload);
    return () => window.removeEventListener(MEMBERS_CHANGED, reload);
  }, []);

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
        if (!cancelled)
          setError(reason instanceof Error ? reason.message : "Unable to load staff.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [organizationId, version]);

  return {
    members,
    activeMembers: members.filter((member) => member.isActive && !member.invitePending),
    loading,
    error,
  };
}
