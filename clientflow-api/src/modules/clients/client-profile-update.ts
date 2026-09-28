import { BadRequestException } from '@nestjs/common';

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

const ALLOWED_FIELDS = new Set<string>([
  ...REQUIRED_STRING_FIELDS,
  ...NULLABLE_STRING_FIELDS,
  ...NULLABLE_DATE_FIELDS,
  ...BOOLEAN_FIELDS,
  // Rejected with a specific message below rather than as an unknown field.
  'lifecycleStatus',
]);

export type ClientProfileUpdate = Record<string, string | boolean | Date | null>;

/**
 * Builds the Prisma `data` for PATCH admin/cf/clients/:id from an explicit allowlist, so a request
 * body can never write `organizationId`, `isDemo`, `programId`, `source`, `intake`, `socialLinks`
 * or any other column that has its own controlled path.
 *
 * Unknown keys are rejected (not silently dropped) so a frontend regression is loud.
 */
export function buildClientProfileUpdate(body: unknown): ClientProfileUpdate {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    throw new BadRequestException('A JSON object body is required.');
  }
  const input = body as Record<string, unknown>;

  if (input.lifecycleStatus !== undefined) {
    throw new BadRequestException('Client lifecycle state cannot be changed through the generic update endpoint.');
  }
  if (typeof input.status === 'string' && AUTOMATED_CLIENT_STATUSES.has(input.status)) {
    throw new BadRequestException('Client workflow statuses cannot be changed through the generic update endpoint.');
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
    data[field] = value;
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
