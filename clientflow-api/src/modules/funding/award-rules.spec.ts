import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/clientflow';
import {
  assertCanCancel,
  assertCanRecordPayment,
  assertWithinAward,
  outstandingOf,
  parsePositiveAmount,
  paymentStateOf,
  planAwardEdit,
  receivedOf,
  toAmount,
} from './award-rules';

const d = (value: number | string) => new Prisma.Decimal(value);

describe('award rules', () => {
  it('keeps awarded and received separate: $5,000 awarded with $2,500 paid', () => {
    const received = receivedOf([{ amount: d(1500), voidedAt: null }, { amount: d(1000) }, { amount: d(400), voidedAt: new Date() }]);
    expect(toAmount(received)).toBe(2500);
    expect(toAmount(outstandingOf({ amountAwarded: d(5000), status: 'approved' }, received))).toBe(2500);
    expect(paymentStateOf(d(5000), received)).toBe('partially_paid');
    expect(paymentStateOf(d(5000), d(0))).toBe('unpaid');
    expect(paymentStateOf(d(5000), d(5000))).toBe('paid');
    expect(toAmount(outstandingOf({ amountAwarded: d(5000), status: 'cancelled' }, d(0)))).toBe(0);
  });

  it('adds money exactly (no floating point drift)', () => {
    expect(receivedOf([{ amount: d('0.10') }, { amount: d('0.20') }]).eq(d('0.30'))).toBe(true);
  });

  it('accepts only positive amounts with at most two decimals', () => {
    expect(parsePositiveAmount(500)?.toFixed(2)).toBe('500.00');
    expect(parsePositiveAmount('2500.50')?.toFixed(2)).toBe('2500.50');
    for (const bad of [0, -5, '1.234', 'abc', null, undefined, Number.NaN, 1e9]) expect(parsePositiveAmount(bad)).toBeNull();
  });

  it('allows payments after approval, and after signing when the agreement needs a signature', () => {
    expect(() => assertCanRecordPayment('approved', true)).not.toThrow();
    expect(() => assertCanRecordPayment('agreement_signed', true)).not.toThrow();
    expect(() => assertCanRecordPayment('agreement_sent', false)).not.toThrow();
    expect(() => assertCanRecordPayment('agreement_sent', true)).toThrow('must be signed');
    expect(() => assertCanRecordPayment('pending', true)).toThrow('Approve the award');
    expect(() => assertCanRecordPayment('cancelled', true)).toThrow('cancelled');
  });

  it('never lets received go above awarded', () => {
    expect(() => assertWithinAward(d(5000), d(2500), d(2500))).not.toThrow();
    expect(() => assertWithinAward(d(5000), d(2500), d('2500.01'))).toThrow('$2500.00 still owed');
    expect(() => assertWithinAward(d(5000), d(5000), d(1))).toThrow('already paid in full');
  });

  describe('editing', () => {
    const award = (status: string) => ({
      status, title: 'Award', source: 'IDI Member Fund', amountAwarded: d(5000), awardDate: new Date('2026-11-12T05:00:00Z'),
    });

    it('lets notes and the expected payment date change at any time, without touching the agreement', () => {
      const plan = planAwardEdit(award('agreement_signed'), { notes: 'Called', expectedPaymentDate: new Date() }, d(0));
      expect(plan.replacesAgreement).toBe(false);
    });

    it('never lets the amount drop below what was received', () => {
      expect(() => planAwardEdit(award('approved'), { amountAwarded: d(2000) }, d(2500))).toThrow(BadRequestException);
      expect(planAwardEdit(award('approved'), { amountAwarded: d(2500) }, d(2500)).replacesAgreement).toBe(false);
    });

    it('changes agreement fields freely before an agreement exists', () => {
      expect(planAwardEdit(award('pending'), { title: 'New', amountAwarded: d(6000) }, d(0)).replacesAgreement).toBe(false);
      expect(planAwardEdit(award('approved'), { awardDate: new Date('2026-12-01') }, d(0)).replacesAgreement).toBe(false);
    });

    it.each(['agreement_sent', 'agreement_signed'])('needs explicit replacement to change agreement fields once %s', (status) => {
      expect(() => planAwardEdit(award(status), { amountAwarded: d(6000) }, d(0))).toThrow(ConflictException);
      expect(planAwardEdit(award(status), { amountAwarded: d(6000) }, d(0), { replaceAgreement: true }).replacesAgreement).toBe(true);
      // Sending the same values is not a change.
      expect(planAwardEdit(award(status), { amountAwarded: d('5000.00'), title: 'Award' }, d(0)).replacesAgreement).toBe(false);
    });

    it('freezes a cancelled award', () => {
      expect(() => planAwardEdit(award('cancelled'), { notes: 'x' }, d(0))).toThrow('cancelled');
    });
  });

  it('cancels only awards with nothing paid', () => {
    expect(() => assertCanCancel('approved', d(0))).not.toThrow();
    expect(() => assertCanCancel('approved', d(1))).toThrow('Payments have been recorded');
    expect(() => assertCanCancel('cancelled', d(0))).toThrow('already cancelled');
  });
});
