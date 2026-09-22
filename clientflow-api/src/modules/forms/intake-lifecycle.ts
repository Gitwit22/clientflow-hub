import { createHash, randomBytes } from 'node:crypto';

export const CLIENT_STATUS = {
  intakeSent: 'INTAKE_SENT',
  intakeSubmitted: 'INTAKE_SUBMITTED',
  programSelected: 'PROGRAM_SELECTED',
} as const;

export const FORM_STATUS = {
  sent: 'sent',
  submitted: 'submitted',
} as const;

export const PROGRAM_OPTIONS = [
  'Brand Awareness Subscription',
  '30-Day Premier Workshop Subscription',
  'Event Planning',
  'Commercial Property',
  'Grant',
  'Interest',
  'Sponsorship',
  'Other / Unsure',
  'The Inspired Detroit Initiative',
] as const;

export type ProgramOption = typeof PROGRAM_OPTIONS[number];

export interface PublicFormField {
  id: string;
  label: string;
  /** Not restricted to the fields this system creates — orgs may reuse a richer existing template. */
  type: string;
  required: boolean;
  options?: readonly string[];
}

export const PROGRAM_SELECTION_FIELD: PublicFormField = {
  id: 'selectedProgram',
  label: 'Program of interest',
  type: 'select',
  required: false,
  options: PROGRAM_OPTIONS,
};

export const GENERAL_INTAKE_FIELDS: PublicFormField[] = [
  { id: 'contactName', label: 'Contact name', type: 'text', required: true },
  { id: 'businessName', label: 'Business name', type: 'text', required: false },
  { id: 'email', label: 'Email', type: 'email', required: true },
  { id: 'phone', label: 'Phone', type: 'phone', required: false },
  PROGRAM_SELECTION_FIELD,
];

export function generatePublicToken(): string {
  return randomBytes(32).toString('base64url');
}

export function hashPublicToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function generalIntakeTemplateId(organizationId: string): string {
  return `general-intake-${createHash('sha256').update(organizationId).digest('hex').slice(0, 24)}`;
}

function isPublicFormField(value: unknown): value is PublicFormField {
  if (!value || typeof value !== 'object') return false;
  const field = value as Record<string, unknown>;
  return typeof field['id'] === 'string'
    && typeof field['label'] === 'string'
    && typeof field['type'] === 'string'
    && typeof field['required'] === 'boolean'
    && (field['options'] === undefined
      || (Array.isArray(field['options']) && field['options'].every((option) => typeof option === 'string')));
}

export function publicIntakeFields(value: unknown): PublicFormField[] {
  const fields = Array.isArray(value) ? value.filter(isPublicFormField) : [];
  return fields.some((field) => field.id === PROGRAM_SELECTION_FIELD.id)
    ? fields
    : [...fields, PROGRAM_SELECTION_FIELD];
}

export function isProgramOption(value: unknown): value is ProgramOption {
  return typeof value === 'string' && PROGRAM_OPTIONS.includes(value as ProgramOption);
}
