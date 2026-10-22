import { isSendableEmail } from '../communications/recipient';

/** A program member as read for a program-wide email. */
export interface ProgramMember {
  clientId: string;
  enrollmentId: string;
  businessName: string;
  contactName: string;
  email: string | null;
}

export interface ProgramEmailRecipient {
  clientId: string;
  enrollmentId: string;
  businessName: string;
  /** The greeting name: the contact name, else the business name. */
  name: string;
  /** Trimmed and lower-cased, so each address gets one copy. */
  email: string;
}

export type SkipReason = 'missing_email' | 'invalid_email' | 'duplicate_email';

export interface SkippedMember {
  clientId: string;
  businessName: string;
  email: string | null;
  reason: SkipReason;
}

export interface RecipientList {
  recipients: ProgramEmailRecipient[];
  skipped: SkippedMember[];
}

/**
 * Everyone enrolled in the program, one copy per email address. Members without a usable address
 * are listed as skipped (so staff can see who and why), and so is a second member sharing an
 * address already on the list. Ordered by business name so the review list and the send agree.
 */
export function buildRecipientList(members: readonly ProgramMember[]): RecipientList {
  const ordered = [...members].sort(
    (a, b) => a.businessName.localeCompare(b.businessName) || a.clientId.localeCompare(b.clientId),
  );
  const seen = new Set<string>();
  const seenClients = new Set<string>();
  const recipients: ProgramEmailRecipient[] = [];
  const skipped: SkippedMember[] = [];
  for (const member of ordered) {
    // A client enrolled in the program twice is one member.
    if (seenClients.has(member.clientId)) continue;
    seenClients.add(member.clientId);
    const raw = member.email?.trim() ?? '';
    if (!raw) {
      skipped.push({ clientId: member.clientId, businessName: member.businessName, email: null, reason: 'missing_email' });
      continue;
    }
    if (!isSendableEmail(raw)) {
      skipped.push({ clientId: member.clientId, businessName: member.businessName, email: raw, reason: 'invalid_email' });
      continue;
    }
    const email = raw.toLowerCase();
    if (seen.has(email)) {
      skipped.push({ clientId: member.clientId, businessName: member.businessName, email, reason: 'duplicate_email' });
      continue;
    }
    seen.add(email);
    recipients.push({
      clientId: member.clientId,
      enrollmentId: member.enrollmentId,
      businessName: member.businessName,
      name: member.contactName.trim() || member.businessName,
      email,
    });
  }
  return { recipients, skipped };
}
