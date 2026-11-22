import { isTestRecord, type MaybeTestRecord } from "@/lib/test-records";

/** Marks a test client wherever it is listed; renders nothing for a real client. */
export function TestClientBadge({
  client,
  className = "",
}: {
  client: MaybeTestRecord | null | undefined;
  className?: string;
}) {
  if (!isTestRecord(client)) return null;
  return (
    <span
      title="Test client: left out of counts and reports, and can be deleted with everything it recorded."
      className={`inline-flex items-center rounded-md border border-amber-300 bg-amber-50 px-1.5 py-0.5 align-middle text-[11px] font-semibold uppercase tracking-wide text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200 ${className}`}
    >
      Test
    </span>
  );
}
