/** The fields whose value differs from what the client had (arrays compared by content). */
export function changedFields(next: Record<string, unknown>, current: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(next).filter(
      ([key, value]) => JSON.stringify(value ?? null) !== JSON.stringify(current[key] ?? null),
    ),
  );
}
