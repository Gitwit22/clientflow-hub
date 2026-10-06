import { selectNextAction, summarizeDeliverables } from './deliverable-summary';

const item = (status: string, extra: Partial<{ isNextAction: boolean; scheduledFor: Date | null; sortOrder: number }> = {}) => ({
  status: status as never,
  isNextAction: false,
  scheduledFor: null,
  sortOrder: 0,
  ...extra,
});

describe('summarizeDeliverables', () => {
  it('reports delivered/completed, available and not applicable separately', () => {
    expect(
      summarizeDeliverables([
        item('DELIVERED'),
        item('COMPLETED'),
        item('DELIVERED'),
        item('COMPLETED'),
        item('DELIVERED'),
        item('AVAILABLE'),
        item('NOT_APPLICABLE'),
      ]),
    ).toEqual({ total: 7, deliveredOrCompleted: 5, available: 1, notApplicable: 1, open: 1 });
  });

  it('never counts not applicable as delivered', () => {
    const summary = summarizeDeliverables([...Array(6)].map(() => item('DELIVERED')).concat(item('NOT_APPLICABLE')));
    expect(summary.deliveredOrCompleted).toBe(6);
    expect(summary.open).toBe(0);
  });
});

describe('selectNextAction', () => {
  const oct21 = new Date('2026-10-21T00:00:00.000Z');
  const oct28 = new Date('2026-10-28T00:00:00.000Z');

  it('uses the explicit mark while that item is unresolved', () => {
    const marked = item('AVAILABLE', { isNextAction: true });
    expect(selectNextAction([item('SCHEDULED', { scheduledFor: oct21 }), marked])).toBe(marked);
  });

  it('ignores a mark on a resolved item and falls back to the earliest scheduled one', () => {
    const later = item('SCHEDULED', { scheduledFor: oct28 });
    const sooner = item('SCHEDULED', { scheduledFor: oct21 });
    expect(selectNextAction([item('COMPLETED', { isNextAction: true }), later, sooner])).toBe(sooner);
    expect(selectNextAction([item('DELIVERED', { scheduledFor: oct21 }), later])).toBe(later);
  });

  it('never picks an unscheduled item on its own', () => {
    expect(selectNextAction([item('AVAILABLE'), item('NOT_STARTED')])).toBeNull();
  });
});
