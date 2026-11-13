import { createHash } from 'node:crypto';

/**
 * Merge fields for agreement templates: `{{client.businessName}}`, `{{award.amount}}` and so on.
 *
 * Templates are validated when a version is saved (unknown fields, or award fields in an enrollment
 * agreement, are rejected). When an agreement is generated, a known field with no value blocks it,
 * so a client is never sent an agreement with a blank where their details belong. Values are
 * inserted as plain text: agreement content is plain text everywhere it is shown.
 */

export type AgreementPurpose = 'enrollment' | 'award';

export const AGREEMENT_PURPOSES: readonly AgreementPurpose[] = ['enrollment', 'award'];

export function parseAgreementPurpose(value: unknown): AgreementPurpose | null {
  return value === 'enrollment' || value === 'award' ? value : null;
}

export interface MergeFieldDefinition {
  key: string;
  label: string;
  /** Agreement purposes the field can be used in. */
  purposes: readonly AgreementPurpose[];
  /** What staff see in the sample preview. */
  sample: string;
}

const BOTH: readonly AgreementPurpose[] = ['enrollment', 'award'];

export const MERGE_FIELDS: readonly MergeFieldDefinition[] = [
  { key: 'client.contactName', label: 'Client contact name', purposes: BOTH, sample: 'Jordan Rivers' },
  { key: 'client.businessName', label: 'Business name', purposes: BOTH, sample: 'Rivers Bakery LLC' },
  { key: 'client.email', label: 'Client email', purposes: BOTH, sample: 'jordan@riversbakery.example' },
  { key: 'program.name', label: 'Program name', purposes: BOTH, sample: 'Inspired Detroit Initiative' },
  { key: 'organization.name', label: 'Organization name', purposes: BOTH, sample: 'EA Management LLC' },
  { key: 'enrollment.startDate', label: 'Program start date', purposes: BOTH, sample: 'November 1, 2026' },
  { key: 'today', label: "Today's date", purposes: BOTH, sample: 'November 13, 2026' },
  { key: 'award.title', label: 'Award title', purposes: ['award'], sample: 'Member Business Achievement Award' },
  { key: 'award.source', label: 'Award source', purposes: ['award'], sample: 'IDI Member Fund' },
  { key: 'award.amount', label: 'Award amount', purposes: ['award'], sample: '$500.00' },
  { key: 'award.date', label: 'Award date', purposes: ['award'], sample: 'November 12, 2026' },
];

const FIELD_BY_KEY = new Map(MERGE_FIELDS.map((field) => [field.key, field]));

/** `{{ client.businessName }}`, allowing spaces inside the braces. */
const FIELD_PATTERN = /{{\s*([a-zA-Z0-9_.]+)\s*}}/g;

/** Every distinct field a template uses, in order of first use. */
export function fieldsUsed(content: string): string[] {
  const seen = new Set<string>();
  for (const match of content.matchAll(FIELD_PATTERN)) seen.add(match[1]);
  return [...seen];
}

export interface TemplateFieldProblems {
  unknown: string[];
  wrongPurpose: string[];
}

/** The problems with a template's fields for the given purpose (empty lists when it is fine). */
export function templateFieldProblems(content: string, purpose: AgreementPurpose): TemplateFieldProblems {
  const unknown: string[] = [];
  const wrongPurpose: string[] = [];
  for (const key of fieldsUsed(content)) {
    const field = FIELD_BY_KEY.get(key);
    if (!field) unknown.push(key);
    else if (!field.purposes.includes(purpose)) wrongPurpose.push(key);
  }
  return { unknown, wrongPurpose };
}

/** A staff-facing explanation of a template's field problems, or null when there are none. */
export function templateFieldProblemMessage(content: string, purpose: AgreementPurpose): string | null {
  const { unknown, wrongPurpose } = templateFieldProblems(content, purpose);
  const parts: string[] = [];
  if (unknown.length) {
    parts.push(`Unknown merge field${unknown.length > 1 ? 's' : ''}: ${unknown.map((key) => `{{${key}}}`).join(', ')}.`);
  }
  if (wrongPurpose.length) {
    parts.push(
      `Award fields can only be used in award agreements: ${wrongPurpose.map((key) => `{{${key}}}`).join(', ')}.`,
    );
  }
  return parts.length ? parts.join(' ') : null;
}

/** Values for one agreement. A missing or blank value counts as missing. */
export type MergeValues = Partial<Record<string, string | null | undefined>>;

export interface RenderedAgreement {
  text: string;
  /** Known fields the template uses that have no value. Generation is blocked while any remain. */
  missing: Array<{ key: string; label: string }>;
}

/**
 * Fills a template's known fields. Fields not in the registry are left exactly as written: only
 * versions saved before validation existed can contain them, and they must keep rendering as before.
 */
export function renderMergeFields(content: string, values: MergeValues): RenderedAgreement {
  const missing = new Map<string, string>();
  const text = content.replace(FIELD_PATTERN, (whole, key: string) => {
    const field = FIELD_BY_KEY.get(key);
    if (!field) return whole;
    const value = values[key];
    if (value === undefined || value === null || !String(value).trim()) {
      missing.set(key, field.label);
      return whole;
    }
    return String(value).trim();
  });
  return { text, missing: [...missing].map(([key, label]) => ({ key, label })) };
}

/** Sample values for every field, used by the template editor's preview. */
export function sampleMergeValues(): MergeValues {
  return Object.fromEntries(MERGE_FIELDS.map((field) => [field.key, field.sample]));
}

/**
 * A fingerprint of exactly what staff reviewed (title and rendered body). Generation compares it so
 * an agreement is never created from different text than the one shown in the review.
 */
export function agreementContentHash(title: string, text: string): string {
  return createHash('sha256').update(`${title}\n\u0000\n${text}`, 'utf8').digest('hex');
}

const LONG_DATE = new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** "November 12, 2026". Dates are calendar days, so they are formatted in UTC to avoid shifting. */
export function formatAgreementDate(value: Date | null | undefined, timeZone?: string): string | null {
  if (!value || Number.isNaN(value.getTime())) return null;
  if (!timeZone) return LONG_DATE.format(value);
  try {
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone }).format(value);
  } catch {
    return LONG_DATE.format(value);
  }
}

const USD = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** "$5,000.00". Accepts a number or a decimal string (Prisma Decimal values serialize to strings). */
export function formatAgreementAmount(value: number | string | { toString(): string } | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const amount = Number(typeof value === 'object' ? value.toString() : value);
  return Number.isFinite(amount) ? USD.format(amount) : null;
}
