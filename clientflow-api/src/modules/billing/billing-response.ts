import type { Prisma } from '../../generated/clientflow';

/**
 * Billing rows hold money in DECIMAL columns, which Prisma returns as Decimal objects and JSON then
 * encodes as text ("1200.5"). The API promises numbers, and the frontend formats them as numbers, so
 * money is converted here, at the response boundary. Services keep working with Decimal.
 * Amounts are DECIMAL(10,2), well within what a JS number holds exactly to the cent.
 */
type Money = Prisma.Decimal | number | string;

const toAmount = (value: Money): number => Number(value);

export function toAgreementResponse<T extends { amount: Money }>(row: T): Omit<T, 'amount'> & { amount: number };
export function toAgreementResponse<T extends { amount: Money }>(row: T | null): (Omit<T, 'amount'> & { amount: number }) | null;
export function toAgreementResponse<T extends { amount: Money }>(row: T | null) {
  return row ? { ...row, amount: toAmount(row.amount) } : null;
}

export function toPaymentResponse<T extends { amount: Money }>(row: T): Omit<T, 'amount'> & { amount: number } {
  return { ...row, amount: toAmount(row.amount) };
}

export function toProgramConfigResponse<T extends { defaultAmount: Money }>(row: T): Omit<T, 'defaultAmount'> & { defaultAmount: number } {
  return { ...row, defaultAmount: toAmount(row.defaultAmount) };
}

export function toBillingSummaryResponse<
  T extends { agreement: { amount: Money } | null; payments: Array<{ amount: Money }> },
>(summary: T) {
  return {
    ...summary,
    agreement: toAgreementResponse(summary.agreement),
    payments: summary.payments.map(toPaymentResponse),
  };
}
