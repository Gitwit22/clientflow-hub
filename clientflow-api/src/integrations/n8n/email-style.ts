import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/clientflow';
import { ADMIN_ROLES, type AdminRoleName } from '../../common/authorization/role-policy';

/**
 * How emails are signed and laid out: the organization's default (Settings, stored in
 * organization.settings) and a program's own choice (CfProgram), which replaces it for that
 * program's emails. With nothing set, nothing is sent and the email workflow keeps its own
 * sign-off and centered layout, so existing emails look the same.
 */
export type EmailLayout = 'left' | 'left-edge' | 'center';
export const EMAIL_LAYOUTS: readonly EmailLayout[] = ['left', 'left-edge', 'center'];
export const EMAIL_SIGNATURE_MAX = 1000;

export interface EmailStyle {
  /** The sign-off as plain text (line breaks kept), for the text version. */
  signatureText?: string;
  /** The sign-off as escaped HTML with <br> line breaks. */
  signatureHtml?: string;
  /**
   * 'left': header and message aligned left with a margin; 'left-edge': the same, but the logo
   * starts at the very left edge (only the text keeps the margin); 'center': today's centered header.
   */
  layout?: EmailLayout;
}

/** The style fields as the n8n email workflow receives them. */
export interface WireEmailStyle {
  signatureText?: string;
  signatureHtml?: string;
  layout?: 'left' | 'center';
  /** With layout 'left': the logo starts at the very left edge; the text keeps its margin. */
  logoAtEdge?: true;
}

/**
 * 'left-edge' goes to n8n as layout 'left' plus logoAtEdge, so a workflow that doesn't know
 * logoAtEdge yet still sends the familiar left layout instead of falling back to centered.
 */
export function toWireStyle(style: EmailStyle): WireEmailStyle {
  const { layout, ...rest } = style;
  if (layout === 'left-edge') return { ...rest, layout: 'left', logoAtEdge: true };
  return { ...rest, ...(layout ? { layout } : {}) };
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

export function signatureToHtml(signature: string): string {
  return escapeHtml(signature).replace(/\r?\n/g, '<br/>');
}

/** A signature value from staff: trimmed, at most EMAIL_SIGNATURE_MAX characters; empty means none. */
export function parseEmailSignature(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') throw new BadRequestException('The email signature must be text.');
  const signature = value.replace(/\r\n/g, '\n').trim();
  if (signature.length > EMAIL_SIGNATURE_MAX) {
    throw new BadRequestException(`Keep the email signature under ${EMAIL_SIGNATURE_MAX} characters.`);
  }
  return signature || null;
}

/** A layout value from staff: 'left', 'left-edge', 'center', or empty for the default. */
export function parseEmailLayout(value: unknown): EmailLayout | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && (EMAIL_LAYOUTS as readonly string[]).includes(value)) return value as EmailLayout;
  throw new BadRequestException('The email layout must be "left", "left-edge" or "center".');
}

/** Signatures by staff role, e.g. { org_admin: 'Thank you,\nEAM Administration', reviewer: '…' }. */
export type EmailSignaturesByRole = Partial<Record<AdminRoleName, string | null>>;

/** A role-signature map from staff: only known roles, each a valid signature (empty means none). */
export function parseEmailSignaturesByRole(value: unknown): EmailSignaturesByRole {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('Role signatures must be a list of signatures by role.');
  }
  const result: EmailSignaturesByRole = {};
  for (const [role, signature] of Object.entries(value as Record<string, unknown>)) {
    if (!(ADMIN_ROLES as readonly string[]).includes(role)) {
      throw new BadRequestException(`Unknown role "${role}" for an email signature.`);
    }
    result[role as AdminRoleName] = parseEmailSignature(signature);
  }
  return result;
}

/**
 * The signature saved for a staff role, if any. Settings shows super admins as Admins, so a super
 * admin without a signature of their own uses the Admin one.
 */
function roleSignature(settings: unknown, role: string | null | undefined): string | null {
  if (!role || !settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const map = (settings as Record<string, unknown>).emailSignaturesByRole;
  if (!map || typeof map !== 'object' || Array.isArray(map)) return null;
  const signatureFor = (key: string) => {
    const value = (map as Record<string, unknown>)[key];
    return typeof value === 'string' && value.trim() ? value : null;
  };
  return signatureFor(role) ?? (role === 'super_admin' ? signatureFor('org_admin') : null);
}

function settingString(settings: unknown, key: string): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const value = (settings as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

type Db = Pick<Prisma.TransactionClient, 'organization' | 'cfProgram'>;

/**
 * The style for an organization's email. The signature is the sender's role signature when a
 * staff member sent it and their role has one; otherwise the program's own, otherwise the
 * organization's. The layout is the program's, otherwise the organization's.
 * `organizationSettings` can be passed when the caller already has them (one lookup per email).
 */
export async function resolveEmailStyle(
  db: Db,
  organizationId: string,
  programId?: string | null,
  organizationSettings?: unknown,
  senderRole?: string | null,
): Promise<EmailStyle> {
  const [settings, program] = await Promise.all([
    organizationSettings !== undefined
      ? Promise.resolve(organizationSettings)
      : db.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }).then((row) => row?.settings),
    programId
      ? db.cfProgram.findFirst({ where: { id: programId, organizationId }, select: { emailSignature: true, emailLayout: true } })
      : Promise.resolve(null),
  ]);
  const signature =
    roleSignature(settings, senderRole) || program?.emailSignature?.trim() || settingString(settings, 'emailSignature');
  const layoutValue = program?.emailLayout || settingString(settings, 'emailLayout');
  const layout = layoutValue && (EMAIL_LAYOUTS as readonly string[]).includes(layoutValue) ? (layoutValue as EmailLayout) : undefined;
  return {
    ...(signature ? { signatureText: signature, signatureHtml: signatureToHtml(signature) } : {}),
    ...(layout ? { layout } : {}),
  };
}
