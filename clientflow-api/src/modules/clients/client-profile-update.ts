import { BadRequestException } from '@nestjs/common';
import { isOpenableUrl, normalizeExternalUrl } from '../../common/validation/external-url';
import { socialLinksOf } from '../forms/form-profile-mapper';

/**
 * Client workflow states are owned by the intake/contract automation and may not be set through
 * the generic profile update.
 */
export const AUTOMATED_CLIENT_STATUSES = new Set([
  'INTAKE_SENT',
  'INTAKE_SUBMITTED',
  'PROGRAM_SELECTED',
  'PENDING_STAFF_REVIEW',
  'REVIEW_DECLINED',
  'CONTRACT_SENT',
  'CONTRACT_OPENED',
  'ONBOARDING',
]);

/** Required text columns: must be a string when present. */
const REQUIRED_STRING_FIELDS = ['businessName', 'primaryContactName', 'email', 'phone', 'assignedStaff', 'status'] as const;
/** Nullable text columns: a string, or null to clear. */
const NULLABLE_STRING_FIELDS = [
  'website',
  'profileType',
  'relationshipType',
  'assignedUserId',
  'archiveReason',
  'finalStatus',
] as const;
/** Nullable timestamp columns: an ISO/date string, or ''/null to clear. */
const NULLABLE_DATE_FIELDS = ['nextFollowUpDate', 'convertedAt', 'archivedAt'] as const;
const BOOLEAN_FIELDS = ['isArchived'] as const;
/**
 * Intake answers staff may correct through Edit client (the profile is the one place to change
 * client details). `programOfInterest` follows the program pick and `uploadedFiles` the uploads, so
 * neither is editable here.
 */
export const EDITABLE_INTAKE_KEYS = [
  'businessDescription',
  'assistanceRequested',
  'businessType',
  'preferredContact',
  'workPhone',
  'cellPhone',
  'budgetNeed',
  'heardAboutUs',
  'additionalComments',
] as const;
const EDITABLE_INTAKE_KEY_SET = new Set<string>(EDITABLE_INTAKE_KEYS);
const MAX_INTAKE_VALUE_LENGTH = 5000;

const ALLOWED_FIELDS = new Set<string>([
  ...REQUIRED_STRING_FIELDS,
  ...NULLABLE_STRING_FIELDS,
  ...NULLABLE_DATE_FIELDS,
  ...BOOLEAN_FIELDS,
  'socialLinks',
  'intake',
  // Rejected with a specific message below rather than as an unknown field.
  'lifecycleStatus',
]);

export type ClientProfileUpdate = Record<string, string | string[] | boolean | Date | null | Record<string, unknown>>;

/**
 * Builds the Prisma `data` for PATCH admin/cf/clients/:id from an explicit allowlist, so a request
 * body can never write `organizationId`, `isDemo`, `programId`, `source` or any other column that
 * has its own controlled path. Social links must each be an openable web address. `intake` is a
 * partial patch of the editable intake answers, merged into the client's current intake (other
 * keys, such as uploaded files, are kept); `null` or "" clears an answer.
 *
 * Unknown keys are rejected (not silently dropped) so a frontend regression is loud.
 */
export function buildClientProfileUpdate(
  body: unknown,
  current?: { status: string; intake?: unknown },
): ClientProfileUpdate {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('A JSON object body is required.');
  }
  const input = { ...(body as Record<string, unknown>) };

  if (input.lifecycleStatus !== undefined) {
    throw new BadRequestException('Client lifecycle state cannot be changed through the generic update endpoint.');
  }
  // Re-sending the status the client already has is not a change (an edit form sends the whole
  // profile back); only moving a client INTO a workflow status by hand is refused.
  if (current && input.status === current.status) delete input.status;
  if (typeof input.status === 'string' && AUTOMATED_CLIENT_STATUSES.has(input.status)) {
    throw new BadRequestException(
      'That status is set by the intake and contract workflow and can\'t be chosen by hand. Pick another status, or leave it as it is.',
    );
  }

  const unknownKeys = Object.keys(input).filter((key) => input[key] !== undefined && !ALLOWED_FIELDS.has(key));
  if (unknownKeys.length > 0) {
    throw new BadRequestException(`These fields cannot be updated on a client: ${unknownKeys.join(', ')}.`);
  }

  const data: ClientProfileUpdate = {};

  for (const field of REQUIRED_STRING_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'string') throw new BadRequestException(`${field} must be a string.`);
    data[field] = value;
  }

  for (const field of NULLABLE_STRING_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') throw new BadRequestException(`${field} must be a string or null.`);
    data[field] = field === 'website' && value ? normalizeExternalUrl(value) : value;
  }

  if (input.socialLinks !== undefined) {
    const raw: unknown = input.socialLinks;
    if (!Array.isArray(raw) || raw.length > 10 || !raw.every((link) => typeof link === 'string' && link.length <= 500)) {
      throw new BadRequestException('socialLinks must be a list of up to 10 links.');
    }
    const links = raw as string[];
    const unusable = links.filter((link) => link.trim() && !isOpenableUrl(link));
    if (unusable.length > 0) {
      throw new BadRequestException(`These social links are not web addresses: ${unusable.join(', ')}.`);
    }
    data.socialLinks = socialLinksOf(links);
  }

  if (input.intake !== undefined) {
    data.intake = mergeIntakePatch(current?.intake, input.intake);
  }

  for (const field of NULLABLE_DATE_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (value === null || value === '') {
      data[field] = null;
      continue;
    }
    if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
      throw new BadRequestException(`${field} must be a valid date.`);
    }
    data[field] = new Date(value);
  }

  for (const field of BOOLEAN_FIELDS) {
    const value = input[field];
    if (value === undefined) continue;
    if (typeof value !== 'boolean') throw new BadRequestException(`${field} must be true or false.`);
    data[field] = value;
  }

  return data;
}

function mergeIntakePatch(currentIntake: unknown, patch: unknown): Record<string, unknown> {
  if (typeof patch !== 'object' || patch === null || Array.isArray(patch)) {
    throw new BadRequestException('intake must be an object of intake answers.');
  }
  const entries = Object.entries(patch as Record<string, unknown>).filter(([, value]) => value !== undefined);
  const unknownKeys = entries.map(([key]) => key).filter((key) => !EDITABLE_INTAKE_KEY_SET.has(key));
  if (unknownKeys.length > 0) {
    throw new BadRequestException(`These intake answers cannot be edited on a client: ${unknownKeys.join(', ')}.`);
  }
  const merged: Record<string, unknown> =
    typeof currentIntake === 'object' && currentIntake !== null && !Array.isArray(currentIntake)
      ? { ...(currentIntake as Record<string, unknown>) }
      : {};
  for (const [key, value] of entries) {
    if (value !== null && typeof value !== 'string') throw new BadRequestException(`intake.${key} must be text.`);
    if (typeof value === 'string' && value.length > MAX_INTAKE_VALUE_LENGTH) {
      throw new BadRequestException(`intake.${key} must be at most ${MAX_INTAKE_VALUE_LENGTH} characters.`);
    }
    const text = value?.trim() ?? '';
    if (text) merged[key] = text;
    else delete merged[key];
  }
  return merged;
}
