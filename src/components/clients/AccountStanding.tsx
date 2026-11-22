import type { AccountStanding as Standing } from "@/lib/billing-standing";
import { formatMoney } from "@/lib/money";

const MONTHS_SHOWN = 3;

const monthLabel = (date: string) =>
  new Date(date).toLocaleDateString(undefined, { month: "short", year: "numeric" });

/**
 * Whether the client is up to date on their payment schedule. When they're behind, it offers to
 * mark earlier periods as paid (for payments made before ClientFlow, so they don't stay overdue).
 */
export function AccountStanding({
  standing,
  nextDueDate,
  onCatchUp,
}: {
  standing: Standing;
  nextDueDate?: string | null;
  onCatchUp: () => void;
}) {
  if (standing.state === "current") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-sm" aria-label="Account standing">
        <span className="rounded-md border border-emerald-300 bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800 dark:border-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-200">
          Current
        </span>
        <span className="text-muted-foreground">
          Nothing owed so far.
          {nextDueDate ? ` Next payment ${new Date(nextDueDate).toLocaleDateString()}.` : ""}
        </span>
      </div>
    );
  }

  const count = standing.overdue.length;
  const months = standing.overdue
    .slice(0, MONTHS_SHOWN)
    .map((period) => monthLabel(period.dueDate));
  const more = count - months.length;
  return (
    <div className="space-y-1 text-sm" aria-label="Account standing">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-md border border-amber-300 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
          Behind
        </span>
        <span>
          {count} {count === 1 ? "period" : "periods"}, {formatMoney(standing.owed)} overdue (
          {months.join(", ")}
          {more > 0 ? ` and ${more} more` : ""})
        </span>
      </div>
      <button
        type="button"
        onClick={onCatchUp}
        className="text-xs font-medium text-primary underline-offset-2 hover:underline"
      >
        Already paid? Mark earlier periods as paid
      </button>
    </div>
  );
}
