import { BadRequestException } from '@nestjs/common';
import { CfProgramTrigger } from '../../generated/clientflow';

/**
 * Merge fields for emails staff write to clients: custom automatic emails (automation rules with
 * the send_email action) and program email blasts. The names match agreements
 * ({{client.businessName}}); the older short names ({{businessName}}) still render.
 */
export const AUTOMATION_EMAIL_FIELDS = [
  { key: 'client.firstName', label: 'Contact first name', sample: 'Pat' },
  { key: 'client.contactName', label: 'Client contact name', sample: 'Pat Rivers' },
  { key: 'client.businessName', label: 'Business name', sample: 'Rivers Bakery LLC' },
  { key: 'program.name', label: 'Program name', sample: 'Program name' },
  { key: 'organization.name', label: 'Your organization name', sample: 'EA Management' },
  { key: 'staff.name', label: 'Assigned staff member', sample: 'Jordan Lee' },
] as const;

export type AutomationEmailField = (typeof AUTOMATION_EMAIL_FIELDS)[number]['key'];

/** Names rules saved before the dotted names existed; they keep rendering. */
const LEGACY_FIELD_NAMES: Record<string, AutomationEmailField> = {
  contactName: 'client.contactName',
  clientName: 'client.contactName',
  businessName: 'client.businessName',
  programName: 'program.name',
  staffName: 'staff.name',
};

const FIELD_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

/** What sets off a custom email, in staff wording. Every program trigger can send one. */
export const AUTOMATION_EMAIL_TRIGGERS: Record<CfProgramTrigger, string> = {
  [CfProgramTrigger.intake_submitted]: 'When an intake is submitted',
  [CfProgramTrigger.enrollment_created]: 'When a client is added to the program',
  [CfProgramTrigger.enrollment_approved]: 'When enrollment is approved',
  [CfProgramTrigger.contract_signed]: 'When the agreement is signed',
  [CfProgramTrigger.form_completed]: 'When a form is completed',
  [CfProgramTrigger.document_uploaded]: 'When a document is uploaded',
  [CfProgramTrigger.program_completed]: 'When the program is completed',
};

export const SUBJECT_MAX = 200;
export const MESSAGE_MAX = 10_000;

const fieldOf = (name: string): AutomationEmailField | null => {
  if ((AUTOMATION_EMAIL_FIELDS as readonly { key: string }[]).some((field) => field.key === name)) return name as AutomationEmailField;
  return LEGACY_FIELD_NAMES[name] ?? null;
};

/** Merge fields used in the text that ClientFlow doesn't know. */
export function unknownAutomationFields(text: string): string[] {
  const unknown = new Set<string>();
  for (const match of text.matchAll(FIELD_PATTERN)) {
    if (!fieldOf(match[1])) unknown.add(match[1]);
  }
  return [...unknown];
}

/**
 * Checks a custom email before it is saved: a subject and a message, within limits, using only
 * merge fields ClientFlow can fill in. Returns the trimmed text to store.
 */
export function validateAutomationEmail(actionConfig: Record<string, unknown>): { subject: string; message: string } {
  const subject = typeof actionConfig.subject === 'string' ? actionConfig.subject.trim() : '';
  const message = typeof actionConfig.message === 'string' ? actionConfig.message.trim() : '';
  if (!subject) throw new BadRequestException('Add a subject for this email.');
  if (subject.length > SUBJECT_MAX) throw new BadRequestException(`Keep the subject under ${SUBJECT_MAX} characters.`);
  if (!message) throw new BadRequestException('Add the message this email sends.');
  if (message.length > MESSAGE_MAX) throw new BadRequestException(`Keep the message under ${MESSAGE_MAX.toLocaleString('en-US')} characters.`);
  const unknown = unknownAutomationFields(`${subject}\n${message}`);
  if (unknown.length) {
    throw new BadRequestException(
      `Unknown merge field${unknown.length === 1 ? '' : 's'}: ${unknown.map((name) => `{{${name}}}`).join(', ')}. Use one of: ${AUTOMATION_EMAIL_FIELDS.map((field) => `{{${field.key}}}`).join(', ')}.`,
    );
  }
  return { subject, message };
}

/** The first word of a person's name ("Pat Rivers" → "Pat"); empty for no name. */
export function firstNameOf(fullName: string | null | undefined): string {
  const value = (fullName ?? '').trim();
  if (!value) return '';
  return value.split(/\s+/)[0] || value;
}

/** What a client field says when its value is missing: never raw braces in a client's inbox. */
const CLIENT_FALLBACK = 'there';

const filled = (value: string | null | undefined): string => (typeof value === 'string' ? value.trim() : '');

/**
 * Fills in the merge fields. Client fields fall back so a client never sees raw braces:
 * a missing name uses the business name, a missing business name uses the contact name, and with
 * neither the field reads "there". Contact first name comes from the contact name when not given.
 * Any other field with no value is left as written, so the gap stays visible to staff.
 */
export function renderAutomationText(text: string, values: Partial<Record<AutomationEmailField, string | null | undefined>>): string {
  const contactName = filled(values['client.contactName']);
  const businessName = filled(values['client.businessName']);
  const firstName = filled(values['client.firstName']) || firstNameOf(contactName);
  const client: Record<string, string> = {
    'client.firstName': firstName || businessName || CLIENT_FALLBACK,
    'client.contactName': contactName || businessName || CLIENT_FALLBACK,
    'client.businessName': businessName || contactName || CLIENT_FALLBACK,
  };
  return text.replace(FIELD_PATTERN, (placeholder, name: string) => {
    const field = fieldOf(name);
    if (!field) return placeholder;
    if (field in client) return client[field];
    const value = filled(values[field]);
    return value || placeholder;
  });
}

/** Sample values for previews and test sends. */
export function sampleAutomationValues(overrides: Partial<Record<AutomationEmailField, string>> = {}) {
  return {
    ...Object.fromEntries(AUTOMATION_EMAIL_FIELDS.map((field) => [field.key, field.sample])),
    ...overrides,
  } as Record<AutomationEmailField, string>;
}
