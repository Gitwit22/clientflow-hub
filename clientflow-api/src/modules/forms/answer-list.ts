export interface AnswerField {
  id: string;
  label: string;
  type?: string;
}

export interface LabelledAnswer {
  fieldId: string;
  label: string;
  type?: string;
  value: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Field definitions from a template's `fields` or a rendered section, ignoring malformed entries. */
export function answerFields(value: unknown): AnswerField[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((field) =>
    isRecord(field) && typeof field.id === 'string'
      ? [{
        id: field.id,
        label: typeof field.label === 'string' && field.label ? field.label : field.id,
        ...(typeof field.type === 'string' ? { type: field.type } : {}),
      }]
      : [],
  );
}

/**
 * Stored answers (a flat `{ fieldId: value }` object) as a labelled list for display, in the form's
 * field order. Answers whose field is no longer on the form are kept at the end under their id, so
 * nothing a client submitted is hidden.
 */
export function labelledAnswers(fields: AnswerField[], payload: unknown): LabelledAnswer[] {
  if (Array.isArray(payload)) return payload as LabelledAnswer[];
  if (!isRecord(payload)) return [];
  const known = new Set(fields.map((field) => field.id));
  return [
    ...fields
      .filter((field) => field.id in payload)
      .map((field) => ({ fieldId: field.id, label: field.label, ...(field.type ? { type: field.type } : {}), value: payload[field.id] })),
    ...Object.entries(payload)
      .filter(([id]) => !known.has(id))
      .map(([id, value]) => ({ fieldId: id, label: id, value })),
  ];
}
