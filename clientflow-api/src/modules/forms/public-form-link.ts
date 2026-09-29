import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import type { TenantDb } from '../../common/tenancy/org-scoped.repository';
import { hashPublicToken } from './intake-lifecycle';

/**
 * The one set of rules for a client's public form link (`/s/:token`, `/apply/:token`). Every public
 * route resolves its link through here, so a cancelled, expired or already-submitted link can never
 * be used to change workflow state, whichever route the link arrives on.
 */
export const PUBLIC_FORM_NOT_FOUND = 'This form link is invalid or unavailable.';
export const PUBLIC_FORM_CLOSED = 'This form link is no longer active. Please contact us for a new link.';
export const PUBLIC_FORM_ALREADY_SUBMITTED = 'This form has already been submitted.';

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/;
const CLOSED_STATUSES = new Set(['cancelled', 'expired']);
const SUBMITTED_STATUSES = new Set(['submitted', 'under_review', 'approved']);

export type PublicFormLinkMode =
  /** Reading the form. A submitted form may still be viewed (the page shows it as complete). */
  | 'view'
  /** Anything that changes state: saving answers or submitting. */
  | 'submit';

interface LinkAssignment {
  cancelledAt: Date | null;
  expiresAt: Date | null;
  submittedAt: Date | null;
  status: string;
}

/** Pure state check, shared by the resolver and its tests. */
export function assertPublicFormLinkUsable(assignment: LinkAssignment, mode: PublicFormLinkMode, now = new Date()): void {
  if (assignment.cancelledAt || CLOSED_STATUSES.has(assignment.status)) throw new GoneException(PUBLIC_FORM_CLOSED);
  if (assignment.expiresAt && assignment.expiresAt.getTime() < now.getTime()) {
    throw new GoneException(PUBLIC_FORM_CLOSED);
  }
  if (mode === 'submit' && (assignment.submittedAt || SUBMITTED_STATUSES.has(assignment.status))) {
    throw new ConflictException(PUBLIC_FORM_ALREADY_SUBMITTED);
  }
}

export async function resolvePublicFormLink(db: TenantDb, rawToken: string, mode: PublicFormLinkMode) {
  if (typeof rawToken !== 'string' || !TOKEN_PATTERN.test(rawToken)) throw new NotFoundException(PUBLIC_FORM_NOT_FOUND);
  const assignment = await db.cfFormAssignment.findUnique({ where: { secureLinkToken: hashPublicToken(rawToken) } });
  if (!assignment) throw new NotFoundException(PUBLIC_FORM_NOT_FOUND);
  assertPublicFormLinkUsable(assignment, mode);

  const [client, template] = await Promise.all([
    db.cfClient.findFirst({
      where: { id: assignment.clientId, organizationId: assignment.organizationId, isArchived: false },
    }),
    db.cfFormTemplate.findFirst({
      where: { id: assignment.formId, organizationId: assignment.organizationId, isActive: true },
    }),
  ]);
  if (!client || !template) throw new NotFoundException(PUBLIC_FORM_NOT_FOUND);
  return { assignment, client, template };
}
