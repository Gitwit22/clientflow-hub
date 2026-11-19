const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/**
 * One way to show money everywhere: "$1,234.50", or "$1,235" for summary tiles. Numeric text
 * (how DECIMAL amounts arrive when an endpoint doesn't convert them) is shown as its amount, never
 * as a misleading $0.00; anything that isn't a number shows as $0.00.
 */
export function formatMoney(
  value: number | string | null | undefined,
  options: { whole?: boolean } = {},
): string {
  const parsed = typeof value === "string" && value.trim() === "" ? Number.NaN : Number(value);
  const amount = Number.isFinite(parsed) ? parsed : 0;
  return (options.whole ? wholeDollars : cents).format(amount);
}
