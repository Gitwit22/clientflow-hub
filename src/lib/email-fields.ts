import type { TextEdit } from "@/lib/email-format";

/**
 * Personal fields staff can put in an email to clients, filled in for each person when it is sent
 * ({{client.businessName}} becomes "Rivers Bakery"). The server holds the authoritative list and
 * fills them in; these mirror it for the "Insert field" menu, the warnings and the previews.
 */
export interface EmailField {
  key: string;
  label: string;
  sample: string;
}

/** Program email blasts (one program or several). */
export const CLIENT_EMAIL_FIELDS: readonly EmailField[] = [
  { key: "client.firstName", label: "Contact first name", sample: "Pat" },
  { key: "client.contactName", label: "Contact name", sample: "Pat Rivers" },
  { key: "client.businessName", label: "Business name", sample: "Rivers Bakery LLC" },
  { key: "program.name", label: "Program name", sample: "Program name" },
  { key: "organization.name", label: "Your organization name", sample: "EA Management" },
];

/** The welcome email sent after the agreement is signed. */
export const WELCOME_EMAIL_FIELDS: readonly EmailField[] = [
  ...CLIENT_EMAIL_FIELDS,
  { key: "enrollment.startDate", label: "Program start date", sample: "2026-11-01" },
];

/** Older names the server still fills in; accepted so a message using them isn't flagged. */
const ALSO_ACCEPTED: Record<string, readonly string[]> = {
  blast: ["contactName", "clientName", "businessName", "programName"],
  automatic: ["contactName", "clientName", "businessName", "programName", "staffName"],
  welcome: ["client.fullName", "enrollment.nextAction"],
};

const FIELD_PATTERN = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Fields in the text that can't be filled in, each once, in order of first use. */
export function unknownEmailFields(
  text: string,
  fields: readonly EmailField[],
  kind: keyof typeof ALSO_ACCEPTED = "blast",
): string[] {
  const known = new Set([...fields.map((field) => field.key), ...ALSO_ACCEPTED[kind]]);
  const unknown: string[] = [];
  for (const match of text.matchAll(FIELD_PATTERN)) {
    if (!known.has(match[1]) && !unknown.includes(match[1])) unknown.push(match[1]);
  }
  return unknown;
}

/** The sentence shown when a message uses fields that can't be filled in. */
export function unknownFieldsMessage(unknown: readonly string[]): string {
  const names = unknown.map((name) => `{{${name}}}`).join(", ");
  return unknown.length === 1
    ? `${names} isn't a field ClientFlow can fill in. Use "Insert field" to pick one.`
    : `${names} aren't fields ClientFlow can fill in. Use "Insert field" to pick them.`;
}

/** The text with each known field replaced by its sample value; unknown ones stay as written. */
export function fillWithSamples(
  text: string,
  fields: readonly EmailField[],
  overrides: Record<string, string> = {},
): string {
  return text.replace(FIELD_PATTERN, (placeholder, name: string) => {
    if (overrides[name]) return overrides[name];
    return fields.find((field) => field.key === name)?.sample ?? placeholder;
  });
}

/** Puts {{key}} in place of the selection (or at the cursor), with the cursor after it. */
export function insertField(edit: TextEdit, key: string): TextEdit {
  const token = `{{${key}}}`;
  const value =
    edit.value.slice(0, edit.selectionStart) + token + edit.value.slice(edit.selectionEnd);
  const cursor = edit.selectionStart + token.length;
  return { value, selectionStart: cursor, selectionEnd: cursor };
}

/**
 * The warning for fields in a blast's subject or message that can't be filled in, or null. Sending
 * is held back until it is fixed (the server refuses them too).
 */
export function blastFieldProblem(subject: string, body: string): string | null {
  const unknown = unknownEmailFields(`${subject}\n${body}`, CLIENT_EMAIL_FIELDS);
  return unknown.length ? unknownFieldsMessage(unknown) : null;
}
