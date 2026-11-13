import type { AgreementPurpose } from "@/types";

/**
 * Merge fields staff can put in agreement templates. Mirrors the API's registry
 * (clientflow-api/src/modules/contracts/merge-fields.ts), which is the source of truth: the server
 * rejects unknown fields when a version is saved and fills them in when an agreement is generated.
 * This copy only powers the reference list and the sample preview in the template editor.
 */
export interface AgreementField {
  key: string;
  label: string;
  purposes: readonly AgreementPurpose[];
  sample: string;
}

const BOTH: readonly AgreementPurpose[] = ["enrollment", "award"];

export const AGREEMENT_FIELDS: readonly AgreementField[] = [
  {
    key: "client.contactName",
    label: "Client contact name",
    purposes: BOTH,
    sample: "Jordan Rivers",
  },
  {
    key: "client.businessName",
    label: "Business name",
    purposes: BOTH,
    sample: "Rivers Bakery LLC",
  },
  {
    key: "client.email",
    label: "Client email",
    purposes: BOTH,
    sample: "jordan@riversbakery.example",
  },
  {
    key: "program.name",
    label: "Program name",
    purposes: BOTH,
    sample: "Inspired Detroit Initiative",
  },
  {
    key: "organization.name",
    label: "Organization name",
    purposes: BOTH,
    sample: "EA Management LLC",
  },
  {
    key: "enrollment.startDate",
    label: "Program start date",
    purposes: BOTH,
    sample: "November 1, 2026",
  },
  { key: "today", label: "Today's date", purposes: BOTH, sample: "November 13, 2026" },
  {
    key: "award.title",
    label: "Award title",
    purposes: ["award"],
    sample: "Member Business Achievement Award",
  },
  { key: "award.source", label: "Award source", purposes: ["award"], sample: "IDI Member Fund" },
  { key: "award.amount", label: "Award amount", purposes: ["award"], sample: "$500.00" },
  { key: "award.date", label: "Award date", purposes: ["award"], sample: "November 12, 2026" },
];

const FIELD_PATTERN = /{{\s*([a-zA-Z0-9_.]+)\s*}}/g;
const BY_KEY = new Map(AGREEMENT_FIELDS.map((field) => [field.key, field]));

/** The fields a template of this purpose may use. */
export function fieldsFor(purpose: AgreementPurpose): AgreementField[] {
  return AGREEMENT_FIELDS.filter((field) => field.purposes.includes(purpose));
}

/** Fields in the text that the server would reject for this purpose (shown before saving). */
export function invalidFields(content: string, purpose: AgreementPurpose): string[] {
  const bad = new Set<string>();
  for (const match of content.matchAll(FIELD_PATTERN)) {
    const field = BY_KEY.get(match[1]);
    if (!field || !field.purposes.includes(purpose)) bad.add(match[1]);
  }
  return [...bad];
}

/** The template filled with sample values, so staff can see how a finished agreement reads. */
export function renderWithSamples(content: string): string {
  return content.replace(FIELD_PATTERN, (whole, key: string) => BY_KEY.get(key)?.sample ?? whole);
}

/** Seeded starter templates carry this placeholder sentence; it must not reach a real agreement. */
export const DRAFT_TEMPLATE_PHRASE = "Template draft only";

export function hasDraftLanguage(content: string | null | undefined): boolean {
  return !!content && content.toLowerCase().includes(DRAFT_TEMPLATE_PHRASE.toLowerCase());
}
