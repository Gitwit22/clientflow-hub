const cents = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });
const wholeDollars = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 0,
  maximumFractionDigits: 0,
});

/** One way to show money everywhere: "$1,234.50", or "$1,235" for summary tiles. */
export function formatMoney(
  value: number | null | undefined,
  options: { whole?: boolean } = {},
): string {
  const amount = Number.isFinite(value) ? Number(value) : 0;
  return (options.whole ? wholeDollars : cents).format(amount);
}
