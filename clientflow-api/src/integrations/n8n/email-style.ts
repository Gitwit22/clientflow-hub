import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '../../generated/clientflow';

/**
 * How emails are signed and laid out: the organization's default (Settings, stored in
 * organization.settings) and a program's own choice (CfProgram), which replaces it for that
 * program's emails. With nothing set, nothing is sent and the email workflow keeps its own
 * sign-off and centered layout, so existing emails look the same.
 */
export type EmailLayout = 'left' | 'center';
export const EMAIL_LAYOUTS: readonly EmailLayout[] = ['left', 'center'];
export const EMAIL_SIGNATURE_MAX = 1000;

export interface EmailStyle {
  /** The sign-off as plain text (line breaks kept), for the text version. */
  signatureText?: string;
  /** The sign-off as escaped HTML with <br> line breaks. */
  signatureHtml?: string;
  /** 'left': header and message aligned left with a margin; 'center': today's centered header. */
  layout?: EmailLayout;
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

/** A layout value from staff: 'left', 'center', or empty for the default. */
export function parseEmailLayout(value: unknown): EmailLayout | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'string' && (EMAIL_LAYOUTS as readonly string[]).includes(value)) return value as EmailLayout;
  throw new BadRequestException('The email layout must be "left" or "center".');
}

function settingString(settings: unknown, key: string): string | null {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) return null;
  const value = (settings as Record<string, unknown>)[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

type Db = Pick<Prisma.TransactionClient, 'organization' | 'cfProgram'>;

/**
 * The style for an organization's email, with the program's own choices first when it has any.
 * `organizationSettings` can be passed when the caller already has them (one lookup per email).
 */
export async function resolveEmailStyle(
  db: Db,
  organizationId: string,
  programId?: string | null,
  organizationSettings?: unknown,
): Promise<EmailStyle> {
  const [settings, program] = await Promise.all([
    organizationSettings !== undefined
      ? Promise.resolve(organizationSettings)
      : db.organization.findUnique({ where: { id: organizationId }, select: { settings: true } }).then((row) => row?.settings),
    programId
      ? db.cfProgram.findFirst({ where: { id: programId, organizationId }, select: { emailSignature: true, emailLayout: true } })
      : Promise.resolve(null),
  ]);
  const signature = program?.emailSignature?.trim() || settingString(settings, 'emailSignature');
  const layoutValue = program?.emailLayout || settingString(settings, 'emailLayout');
  const layout = layoutValue && (EMAIL_LAYOUTS as readonly string[]).includes(layoutValue) ? (layoutValue as EmailLayout) : undefined;
  return {
    ...(signature ? { signatureText: signature, signatureHtml: signatureToHtml(signature) } : {}),
    ...(layout ? { layout } : {}),
  };
}
