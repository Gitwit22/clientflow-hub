/**
 * Test clients (created with "This is a test client") and everything recorded for them carry
 * isDemo. They stay visible in client and member lists so staff can try every step, but they never
 * count in Dashboard or Reports numbers. A record without the flag counts.
 */
export type MaybeTestRecord = { isDemo?: boolean | null };

export const isTestRecord = (record: MaybeTestRecord | null | undefined) => record?.isDemo === true;

export function withoutTestRecords<T extends MaybeTestRecord>(rows: readonly T[]): T[] {
  return rows.filter((row) => !isTestRecord(row));
}
