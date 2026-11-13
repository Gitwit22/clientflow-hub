import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/clientflow';

/**
 * The rules for funding awards, in one place: statuses, balances, when a payment may be recorded and
 * what may change after an agreement exists. Money is compared with Prisma.Decimal; amounts become
 * plain numbers only when a response is built.
 */

export const AWARD_STATUS = {
  pending: 'pending',
  approved: 'approved',
  agreementSent: 'agreement_sent',
  agreementSigned: 'agreement_signed',
  cancelled: 'cancelled',
} as const;

export type AwardStatus = (typeof AWARD_STATUS)[keyof typeof AWARD_STATUS];

export const AWARD_STATUSES: readonly AwardStatus[] = Object.values(AWARD_STATUS);

export function isAwardStatus(value: unknown): value is AwardStatus {
  return typeof value === 'string' && (AWARD_STATUSES as readonly string[]).includes(value);
}

type Money = Prisma.Decimal | number | string;

const ZERO = new Prisma.Decimal(0);

export function toDecimal(value: Money): Prisma.Decimal {
  return value instanceof Prisma.Decimal ? value : new Prisma.Decimal(value);
}

/** A money amount for a response: a number with two decimal places. */
export function toAmount(value: Money): number {
  return toDecimal(value).toDecimalPlaces(2).toNumber();
}

/**
 * A positive amount with at most two decimal places (the ledger is DECIMAL(10,2)).
 * Returns null when the input is not one.
 */
export function parsePositiveAmount(value: unknown): Prisma.Decimal | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(value);
  } catch {
    return null;
  }
  if (!amount.isFinite() || amount.lte(0) || amount.decimalPlaces() > 2 || amount.gte(100_000_000)) return null;
  return amount;
}

/** The sum of the payments that count (not voided). */
export function receivedOf(payments: ReadonlyArray<{ amount: Money; voidedAt?: Date | null }>): Prisma.Decimal {
  return payments.reduce((sum, payment) => (payment.voidedAt ? sum : sum.add(toDecimal(payment.amount))), ZERO);
}

/** What is still owed on an award. A cancelled award owes nothing. Never negative. */
export function outstandingOf(award: { amountAwarded: Money; status: string }, received: Prisma.Decimal): Prisma.Decimal {
  if (award.status === AWARD_STATUS.cancelled) return ZERO;
  const owed = toDecimal(award.amountAwarded).sub(received);
  return owed.lt(0) ? ZERO : owed;
}

export type AwardPaymentState = 'unpaid' | 'partially_paid' | 'paid';

/** Calculated from the ledger, never stored. */
export function paymentStateOf(awarded: Money, received: Prisma.Decimal): AwardPaymentState {
  if (received.lte(0)) return 'unpaid';
  return received.gte(toDecimal(awarded)) ? 'paid' : 'partially_paid';
}

/**
 * Whether a payment may be recorded on an award in this status. Payments follow approval; when the
 * award has an agreement that needs a signature, they wait for the signature.
 */
export function assertCanRecordPayment(status: string, agreementNeedsSignature: boolean): void {
  if (status === AWARD_STATUS.approved || status === AWARD_STATUS.agreementSigned) return;
  if (status === AWARD_STATUS.agreementSent && !agreementNeedsSignature) return;
  if (status === AWARD_STATUS.pending) throw new BadRequestException('Approve the award before recording a payment.');
  if (status === AWARD_STATUS.cancelled) throw new BadRequestException('This award was cancelled; payments can no longer be recorded.');
  if (status === AWARD_STATUS.agreementSent) {
    throw new BadRequestException('The award agreement must be signed before a payment is recorded.');
  }
  throw new BadRequestException('Payments cannot be recorded for this award.');
}

/** A payment may never take the amount received above the amount awarded. */
export function assertWithinAward(awarded: Money, received: Prisma.Decimal, amount: Prisma.Decimal): void {
  const outstanding = toDecimal(awarded).sub(received);
  if (amount.gt(outstanding)) {
    throw new BadRequestException(
      outstanding.lte(0)
        ? 'This award is already paid in full.'
        : `This payment is more than the $${outstanding.toFixed(2)} still owed on the award.`,
    );
  }
}

/** Fields an award agreement is written from: changing one after an agreement exists needs a new one. */
export const AGREEMENT_BOUND_FIELDS = ['title', 'source', 'amountAwarded', 'awardDate'] as const;
export type AgreementBoundField = (typeof AGREEMENT_BOUND_FIELDS)[number];

export interface AwardEdit {
  title?: string;
  source?: string;
  amountAwarded?: Prisma.Decimal;
  awardDate?: Date;
  expectedPaymentDate?: Date | null;
  notes?: string;
}

export interface AwardEditPlan {
  data: AwardEdit;
  /** The award's agreement must be retired (an unsigned one cancelled) and a new one prepared. */
  replacesAgreement: boolean;
}

function sameValue(field: AgreementBoundField, current: AwardForEdit, next: AwardEdit): boolean {
  switch (field) {
    case 'amountAwarded':
      return next.amountAwarded === undefined || toDecimal(current.amountAwarded).eq(next.amountAwarded);
    case 'awardDate':
      return next.awardDate === undefined || current.awardDate.getTime() === next.awardDate.getTime();
    default:
      return next[field] === undefined || next[field] === current[field];
  }
}

interface AwardForEdit {
  status: string;
  title: string;
  source: string;
  amountAwarded: Money;
  awardDate: Date;
}

/**
 * Applies the edit rules:
 * - notes and the expected payment date can always change (except on a cancelled award);
 * - the amount can never go below what has been received;
 * - fields the agreement is written from can change freely before an agreement exists; once one is
 *   sent or signed they change only with `replaceAgreement`, which retires that agreement (a signed
 *   one stays as history) and sends the award back to approved for a new agreement.
 */
export function planAwardEdit(
  award: AwardForEdit,
  edit: AwardEdit,
  received: Prisma.Decimal,
  options: { replaceAgreement?: boolean } = {},
): AwardEditPlan {
  if (award.status === AWARD_STATUS.cancelled) throw new BadRequestException('A cancelled award cannot be changed.');
  if (edit.amountAwarded !== undefined && edit.amountAwarded.lt(received)) {
    throw new BadRequestException(
      `The award amount can't be less than the $${received.toFixed(2)} already paid. Void a payment first if it was recorded by mistake.`,
    );
  }
  const changedBound = AGREEMENT_BOUND_FIELDS.filter((field) => !sameValue(field, award, edit));
  const hasAgreement = award.status === AWARD_STATUS.agreementSent || award.status === AWARD_STATUS.agreementSigned;
  if (changedBound.length && hasAgreement && !options.replaceAgreement) {
    throw new ConflictException(
      award.status === AWARD_STATUS.agreementSigned
        ? 'This award has a signed agreement. Changing its title, source, amount or date needs a new agreement: confirm replacing it.'
        : 'This award has an agreement waiting for a signature. Changing its title, source, amount or date cancels that agreement: confirm replacing it.',
    );
  }
  return { data: edit, replacesAgreement: changedBound.length > 0 && hasAgreement };
}

/** Approving is the only staff-driven status change apart from cancelling. */
export function assertCanApprove(status: string): void {
  if (status !== AWARD_STATUS.pending) {
    throw new BadRequestException(status === AWARD_STATUS.cancelled ? 'This award was cancelled.' : 'This award is already approved.');
  }
}

/** An award can be cancelled while nothing has been paid on it; a paid award is a financial record. */
export function assertCanCancel(status: string, received: Prisma.Decimal): void {
  if (status === AWARD_STATUS.cancelled) throw new BadRequestException('This award is already cancelled.');
  if (received.gt(0)) {
    throw new BadRequestException('Payments have been recorded on this award. Void them first if they were recorded by mistake.');
  }
}
