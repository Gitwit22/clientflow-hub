import { Prisma } from '../../generated/clientflow';
import {
  toAgreementResponse,
  toBillingSummaryResponse,
  toPaymentResponse,
  toProgramConfigResponse,
} from './billing-response';

const wire = (value: unknown) => JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

describe('billing responses send money as numbers', () => {
  it('turns Decimal amounts into numbers and leaves every other field alone', () => {
    const paymentDate = new Date('2026-10-03T00:00:00Z');
    const payment = toPaymentResponse({ id: 'p1', amount: new Prisma.Decimal('250.25'), paymentDate, voidedAt: null });
    expect(payment).toEqual({ id: 'p1', amount: 250.25, paymentDate, voidedAt: null });
    expect(wire(payment).amount).toBe(250.25);

    expect(toAgreementResponse({ id: 'a1', amount: new Prisma.Decimal('1200.50'), frequency: 'monthly' }))
      .toEqual({ id: 'a1', amount: 1200.5, frequency: 'monthly' });
    expect(toProgramConfigResponse({ id: 'c1', defaultAmount: new Prisma.Decimal('0'), billingRequired: false }))
      .toEqual({ id: 'c1', defaultAmount: 0, billingRequired: false });
  });

  it('maps the agreement and every payment in a summary, and keeps a missing agreement as null', () => {
    const summary = toBillingSummaryResponse({
      agreement: { id: 'a1', amount: new Prisma.Decimal('99.99') },
      payments: [{ id: 'p1', amount: new Prisma.Decimal('10.10') }, { id: 'p2', amount: new Prisma.Decimal('5') }],
      collected: 15.1,
      nextDueDate: null,
    });
    expect(wire(summary)).toEqual({
      agreement: { id: 'a1', amount: 99.99 },
      payments: [{ id: 'p1', amount: 10.1 }, { id: 'p2', amount: 5 }],
      collected: 15.1,
      nextDueDate: null,
    });

    expect(toBillingSummaryResponse({ agreement: null, payments: [], collected: 0 }))
      .toEqual({ agreement: null, payments: [], collected: 0 });
  });
});
