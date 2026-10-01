import {
  canonicalFieldKey,
  FormFieldShape,
  INTAKE_KEYS,
  PROFILE_FIELD_LABELS,
  SOCIAL_FIELD_IDS,
  TOP_LEVEL_COLUMNS,
} from './form-field-mapping';
import { normalizeExternalUrl, platformFieldUrl } from '../../common/validation/external-url';

export type ProfileTarget = 'top' | 'intake' | 'socialLinks';

/** One submitted answer that maps onto the client profile, whether or not it differs today. */
export interface MappedAnswer {
  key: string;
  label: string;
  target: ProfileTarget;
  value: string | string[];
}

/** A mapped answer that differs from what the profile currently holds. */
export interface ProfileChange extends MappedAnswer {
  currentValue: string;
  newValue: string;
}

export interface CurrentProfile {
  businessName: string;
  primaryContactName: string;
  email: string;
  phone: string;
  website: string | null;
  socialLinks: unknown;
  intake: unknown;
}

const LEGACY_SOCIAL_FIELD_IDS = ['facebookUrl', 'instagramUrl', 'linkedinUrl', 'tiktokUrl', 'youtubeUrl'];
const MAX_SOCIAL_LINKS = 10;

/** Only strings and numbers can be written to a text profile field; everything else is ignored. */
export function answerText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return '';
}

/** Existing profile values are text; anything else counts as empty rather than "[object Object]". */
function plainText(value: unknown): string {
  return typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function socialLinksOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const links: string[] = [];
  for (const entry of value) {
    const link = typeof entry === 'string' ? normalizeExternalUrl(entry) : '';
    const key = link.toLowerCase();
    if (link && !seen.has(key)) {
      seen.add(key);
      links.push(link);
    }
  }
  return links.slice(0, MAX_SOCIAL_LINKS);
}

/**
 * A column only takes an answer that looks like its kind, so "Do you have a website? — Yes" never
 * becomes the website and a "Phone" question answered "Text me" never becomes the phone number.
 */
function plausibleFor(key: string, text: string): boolean {
  if (key === 'website') return /^\S+\.\S+$/.test(text);
  if (key === 'email') return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text);
  if (key === 'phone') return (text.match(/\d/g) ?? []).length >= 7;
  return true;
}

/**
 * Recomputes, from the template fields and the submitted answers only, every value that could be
 * applied to the profile. The first field that maps to a key wins, blank answers are skipped, and
 * arrays/objects/booleans never reach a text column.
 */
export function mapAnswers(
  fields: readonly FormFieldShape[],
  responses: Record<string, unknown>,
): MappedAnswer[] {
  const mapped: MappedAnswer[] = [];
  const seen = new Set<string>();

  for (const field of fields) {
    const key = canonicalFieldKey(field);
    if (!key || SOCIAL_FIELD_IDS.has(key) || seen.has(key)) continue;

    const text = answerText(responses[field.id]);
    if (!text || !plausibleFor(key, text)) continue;

    if (TOP_LEVEL_COLUMNS.has(key)) {
      const value = key === 'website' ? normalizeExternalUrl(text) : text;
      mapped.push({ key, label: PROFILE_FIELD_LABELS[key] ?? key, target: 'top', value });
    } else if (INTAKE_KEYS.has(key)) {
      mapped.push({ key, label: PROFILE_FIELD_LABELS[key] ?? key, target: 'intake', value: text });
    } else {
      continue;
    }
    seen.add(key);
  }

  const repeatableSocial = fields.find((field) => field.type === 'social_links');
  const links = repeatableSocial
    ? socialLinksOf(responses[repeatableSocial.id])
    : socialLinksOf(
        fields
          .filter((field) => LEGACY_SOCIAL_FIELD_IDS.includes(field.id))
          .map((field) => platformFieldUrl(field.id, answerText(responses[field.id])))
          .filter(Boolean),
      );
  if (links.length > 0) {
    mapped.push({
      key: 'socialLinks',
      label: PROFILE_FIELD_LABELS.socialLinks,
      target: 'socialLinks',
      value: links,
    });
  }

  return mapped;
}

function sameLinks(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const normalized = new Set(a.map((link) => link.toLowerCase()));
  return b.every((link) => normalized.has(link.toLowerCase()));
}

/** Keeps only the mapped answers that would change the profile as it stands right now. */
export function diffProfile(mapped: readonly MappedAnswer[], current: CurrentProfile): ProfileChange[] {
  const currentIntake = isRecord(current.intake) ? current.intake : {};
  const changes: ProfileChange[] = [];

  for (const answer of mapped) {
    if (answer.target === 'socialLinks') {
      const incoming = answer.value as string[];
      const existing = socialLinksOf(current.socialLinks);
      if (sameLinks(incoming, existing)) continue;
      changes.push({ ...answer, currentValue: existing.join(', '), newValue: incoming.join(', ') });
      continue;
    }

    const incoming = answer.value as string;
    const existing = plainText(
      answer.target === 'top'
        ? (current as unknown as Record<string, unknown>)[answer.key]
        : currentIntake[answer.key],
    );
    if (existing.trim() === incoming) continue;
    changes.push({ ...answer, currentValue: existing, newValue: incoming });
  }

  return changes;
}

/**
 * How submitted answers reach the profile without staff approving each field:
 * - `submit` (the client just sent their intake): their answers become the profile, except the
 *   business and contact names, which only fill blanks because staff entered them when adding the
 *   client and contracts are addressed with them;
 * - `fill-blanks` (catching up older clients): only empty profile fields are filled, so nothing
 *   staff have edited since is overwritten.
 * The email is never changed this way: it is the address every link is delivered to.
 */
export type ProfileFillMode = 'submit' | 'fill-blanks';

const FILL_BLANKS_ONLY = new Set(['businessName', 'primaryContactName']);
const NEVER_FILLED = new Set(['email']);

export interface ProfileUpdate {
  data: {
    businessName?: string;
    primaryContactName?: string;
    phone?: string;
    website?: string;
    socialLinks?: string[];
    intake?: Record<string, unknown>;
  };
  /** Labels of the fields written, for the activity log. */
  labels: string[];
}

export function profileUpdateFromAnswers(
  mapped: readonly MappedAnswer[],
  current: CurrentProfile,
  mode: ProfileFillMode,
): ProfileUpdate {
  const data: ProfileUpdate['data'] = {};
  const labels: string[] = [];
  const intakeChanges: Record<string, string> = {};

  for (const change of diffProfile(mapped, current)) {
    if (NEVER_FILLED.has(change.key)) continue;
    const blank = change.currentValue.trim() === '';
    if (!blank && (mode === 'fill-blanks' || FILL_BLANKS_ONLY.has(change.key))) continue;

    if (change.target === 'socialLinks') {
      data.socialLinks = socialLinksOf(change.value);
    } else if (change.target === 'top') {
      (data as Record<string, unknown>)[change.key] = change.newValue;
    } else {
      intakeChanges[change.key] = change.newValue;
    }
    labels.push(change.label);
  }

  if (Object.keys(intakeChanges).length > 0) {
    data.intake = { ...(isRecord(current.intake) ? current.intake : {}), ...intakeChanges };
  }
  return { data, labels };
}
