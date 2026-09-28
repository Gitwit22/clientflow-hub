/**
 * Render any stored form answer as display text. Answers are typed as
 * string | string[] | boolean | number | null but arrive from JSON columns, so this is defensive:
 * it never throws and never produces "[object Object]".
 */
export function toText(value: unknown): string {
  if (value == null) return "";

  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "Yes" : "No";

  if (Array.isArray(value)) {
    return value.map(toText).filter(Boolean).join(", ");
  }

  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, entry]) => [key, toText(entry)] as const)
      .filter(([, text]) => text !== "")
      .map(([key, text]) => `${key}: ${text}`)
      .join(", ");
  }

  return String(value);
}
