/**
 * Maps form template fields onto CfClient columns / intake keys.
 *
 * Ported from the retired nxt-lvl-api2 clientflow module (form-field-mapping.ts). Only the parts
 * needed to apply submitted answers to a client profile are carried over.
 */
export interface MappableFormField {
  id: string;
  label: string;
  prefillKey?: string;
}

export interface FormFieldShape extends MappableFormField {
  type: string;
  required: boolean;
  options?: string[];
  helpText?: string;
}

/** Field id (or prefillKey) → the CfClient column it maps to. */
export const TOP_LEVEL_FIELD_KEYS: Record<string, string> = {
  businessName: 'businessName',
  primaryContactName: 'primaryContactName',
  email: 'email',
  phone: 'phone',
  website: 'website',
  business: 'businessName',
  bizName: 'businessName',
  brandName: 'businessName',
  sponsor: 'businessName',
  contact: 'primaryContactName',
  name: 'primaryContactName',
  fullName: 'primaryContactName',
  applicant: 'primaryContactName',
};

/** Field id (or prefillKey) → the key inside CfClient.intake it maps to. */
export const INTAKE_FIELD_KEYS: Record<string, string> = {
  businessDescription: 'businessDescription',
  description: 'businessDescription',
  assistanceRequested: 'assistanceRequested',
  assistance: 'assistanceRequested',
  businessType: 'businessType',
  bizType: 'businessType',
  industry: 'businessType',
  programOfInterest: 'programOfInterest',
  program: 'programOfInterest',
  budgetNeed: 'budgetNeed',
  budget: 'budgetNeed',
  preferredContact: 'preferredContact',
  contact_pref: 'preferredContact',
  heardAboutUs: 'heardAboutUs',
  heard: 'heardAboutUs',
  additionalComments: 'additionalComments',
  comments: 'additionalComments',
};

export const SOCIAL_FIELD_IDS = new Set([
  'socialLinks',
  'facebookUrl',
  'instagramUrl',
  'linkedinUrl',
  'tiktokUrl',
  'youtubeUrl',
]);

/** The CfClient columns a form answer may write. */
export const TOP_LEVEL_COLUMNS = new Set([
  'businessName',
  'primaryContactName',
  'email',
  'phone',
  'website',
]);

/** The intake keys a form answer may write. */
export const INTAKE_KEYS = new Set(Object.values(INTAKE_FIELD_KEYS));

export const PROFILE_FIELD_LABELS: Record<string, string> = {
  primaryContactName: 'Contact name',
  businessName: 'Business name',
  email: 'Email',
  phone: 'Phone',
  website: 'Website',
  socialLinks: 'Social media links',
  businessDescription: 'Business description',
  businessType: 'Business type',
  assistanceRequested: 'Assistance requested',
  programOfInterest: 'Program of interest',
  budgetNeed: 'Budget need',
  preferredContact: 'Preferred contact',
  heardAboutUs: 'How they heard about us',
  additionalComments: 'Additional comments',
};

const FIELD_TYPES = new Set([
  'text', 'email', 'phone', 'url', 'textarea', 'number', 'date', 'select', 'file', 'checkbox',
  'signature', 'social_links',
]);

/**
 * The canonical profile key a field writes to (a CfClient column, an intake key, or a social id),
 * or null when the field is program-specific and does not belong on the profile.
 */
export function canonicalFieldKey(field: MappableFormField): string | null {
  const key = field.prefillKey ?? field.id;
  if (field.id === 'contact' && /preferred/i.test(field.label)) return 'preferredContact';
  return TOP_LEVEL_FIELD_KEYS[key]
    ?? INTAKE_FIELD_KEYS[key]
    ?? (SOCIAL_FIELD_IDS.has(field.id) ? field.id : null);
}

/** Normalizes a CfFormTemplate.fields JSON value into typed fields, dropping malformed entries. */
export function normalizeFormFields(rawFields: unknown): FormFieldShape[] {
  if (!Array.isArray(rawFields)) return [];
  const normalized: FormFieldShape[] = [];
  const seenIds = new Set<string>();

  for (const rawField of rawFields) {
    if (!rawField || typeof rawField !== 'object') continue;
    const value = rawField as Record<string, unknown>;
    const id = typeof value.id === 'string' ? value.id.trim() : '';
    if (!id || seenIds.has(id)) continue;
    seenIds.add(id);

    const label = typeof value.label === 'string' ? value.label.trim() : '';
    const type = typeof value.type === 'string' && FIELD_TYPES.has(value.type) ? value.type : 'text';
    normalized.push({
      id,
      label: label || id,
      type,
      required: value.required === true,
      ...(typeof value.prefillKey === 'string' ? { prefillKey: value.prefillKey } : {}),
      ...(Array.isArray(value.options)
        ? { options: value.options.filter((option): option is string => typeof option === 'string') }
        : {}),
    });
  }
  return normalized;
}
