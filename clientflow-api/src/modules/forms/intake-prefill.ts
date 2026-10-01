import { canonicalFieldKey, INTAKE_KEYS, TOP_LEVEL_COLUMNS } from './form-field-mapping';

export type PrefillValue = string | string[];

export interface PrefillField {
  id: string;
  label: string;
  type: string;
  prefillKey?: string;
}

export interface PrefillClient {
  primaryContactName: string;
  businessName: string;
  email: string;
  phone: string;
  website: string | null;
  socialLinks?: unknown;
  intake?: unknown;
}

/** Answers that can't be carried into a new copy of a form. */
const NOT_PREFILLED_TYPES = new Set(['file', 'signature']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A stored answer in a shape the form page can show again, or undefined. */
function prefillValue(value: unknown): PrefillValue | undefined {
  if (typeof value === 'string') return value.trim() ? value : undefined;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string' && item.trim() !== '');
    return items.length ? items : undefined;
  }
  return undefined;
}

/** The profile's current value for the field, when the field asks for something the profile holds. */
function profileValue(field: PrefillField, client: PrefillClient): PrefillValue | undefined {
  // A social-links question (any id) shows the links on the profile.
  if (field.type === 'social_links') return prefillValue(client.socialLinks);
  const key = canonicalFieldKey(field);
  if (!key) return undefined;
  if (TOP_LEVEL_COLUMNS.has(key)) return prefillValue(client[key as keyof PrefillClient]);
  if (INTAKE_KEYS.has(key)) return isRecord(client.intake) ? prefillValue(client.intake[key]) : undefined;
  return undefined;
}

/**
 * What a new copy of the intake starts with. The client profile is the source of truth, so a field
 * that asks for something on the profile shows the profile's value (including corrections staff
 * made in Edit client); any other field shows the client's previous answer to the same question.
 */
export function buildIntakePrefill(
  fields: PrefillField[],
  client: PrefillClient | null,
  previousAnswers?: unknown,
): Record<string, PrefillValue> {
  const previous = isRecord(previousAnswers) ? previousAnswers : {};
  const prefill: Record<string, PrefillValue> = {};
  for (const field of fields) {
    if (NOT_PREFILLED_TYPES.has(field.type)) continue;
    const value = (client ? profileValue(field, client) : undefined) ?? prefillValue(previous[field.id]);
    if (value !== undefined) prefill[field.id] = value;
  }
  return prefill;
}

/** A program section's previous answers, ready to show again (files and signatures left out). */
export function buildProgramPrefill(fields: PrefillField[], previousAnswers: unknown): Record<string, PrefillValue> {
  return buildIntakePrefill(fields, null, previousAnswers);
}
