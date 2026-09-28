import {
  computeNextDueDate,
  computeOccurrences,
  getCalendarPeriodBounds,
  normalizeToMonthlyEquivalent,
  type BillingSchedule,
} from './billing-schedule.util';

const TZ = 'America/Detroit';

describe('billing-schedule.util', () => {
  describe('computeOccurrences', () => {
    it('generates one occurrence per month on the fixed due day, across a DST boundary', () => {
      const schedule: BillingSchedule = {
        startDate: new Date('2026-01-01T05:00:00.000Z'), // Jan 1 00:00 America/Detroit (EST, UTC-5)
        frequency: 'monthly',
        defaultDueDay: 1,
        timezone: TZ,
      };
      const occurrences = computeOccurrences(
        schedule,
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-05-01T00:00:00.000Z'),
      );
      // Jan/Feb/Mar are EST (UTC-5); Apr is EDT (UTC-4) after the Mar 8 2026 DST change —
      // each occurrence must still land on local midnight, so the UTC hour shifts accordingly.
      expect(occurrences.map((d) => d.toISOString())).toEqual([
        '2026-01-01T05:00:00.000Z',
        '2026-02-01T05:00:00.000Z',
        '2026-03-01T05:00:00.000Z',
        '2026-04-01T04:00:00.000Z',
      ]);
    });

    it('clamps the due day to the last day of shorter months', () => {
      const schedule: BillingSchedule = {
        startDate: new Date('2026-01-31T05:00:00.000Z'),
        frequency: 'monthly',
        defaultDueDay: 31,
        timezone: TZ,
      };
      const occurrences = computeOccurrences(
        schedule,
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-03-31T00:00:00.000Z'),
      );
      // February 2026 has 28 days, so the clamped due date is Feb 28, not Feb 31/Mar 3.
      expect(occurrences[1].toISOString()).toBe('2026-02-28T05:00:00.000Z');
    });

    it('pushes the first occurrence to the following period when the due day precedes the start date', () => {
      const schedule: BillingSchedule = {
        startDate: new Date('2026-01-15T05:00:00.000Z'), // started on the 15th
        frequency: 'monthly',
        defaultDueDay: 1, // but billing is due on the 1st of each month
        timezone: TZ,
      };
      const occurrences = computeOccurrences(
        schedule,
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-02-28T00:00:00.000Z'),
      );
      expect(occurrences).toHaveLength(1);
      expect(occurrences[0].toISOString()).toBe('2026-02-01T05:00:00.000Z');
    });

    it('supports weekly and custom-interval frequencies', () => {
      const weekly = computeOccurrences(
        { startDate: new Date('2026-01-01T05:00:00.000Z'), frequency: 'weekly', timezone: TZ },
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-01-22T00:00:00.000Z'),
      );
      expect(weekly).toHaveLength(3);

      const custom = computeOccurrences(
        { startDate: new Date('2026-01-01T05:00:00.000Z'), frequency: 'custom', customIntervalDays: 10, timezone: TZ },
        new Date('2026-01-01T00:00:00.000Z'),
        new Date('2026-01-25T00:00:00.000Z'),
      );
      expect(custom).toHaveLength(3);
    });

    it('returns exactly one occurrence for one_time regardless of range, if it falls inside it', () => {
      const schedule: BillingSchedule = {
        startDate: new Date('2026-06-15T04:00:00.000Z'),
        frequency: 'one_time',
        timezone: TZ,
      };
      expect(computeOccurrences(schedule, new Date('2026-01-01T00:00:00.000Z'), new Date('2026-12-31T00:00:00.000Z'))).toHaveLength(1);
      expect(computeOccurrences(schedule, new Date('2027-01-01T00:00:00.000Z'), new Date('2027-12-31T00:00:00.000Z'))).toHaveLength(0);
    });
  });

  describe('computeNextDueDate', () => {
    it('returns null once a one_time schedule has already occurred', () => {
      const schedule: BillingSchedule = {
        startDate: new Date('2026-01-15T04:00:00.000Z'),
        frequency: 'one_time',
        timezone: TZ,
      };
      expect(computeNextDueDate(schedule, new Date('2026-02-01T00:00:00.000Z'))).toBeNull();
    });

    it('returns the earliest occurrence on or after the reference date', () => {
      const schedule: BillingSchedule = {
        startDate: new Date('2026-01-01T05:00:00.000Z'),
        frequency: 'monthly',
        defaultDueDay: 1,
        timezone: TZ,
      };
      const next = computeNextDueDate(schedule, new Date('2026-03-15T00:00:00.000Z'));
      expect(next?.toISOString()).toBe('2026-04-01T04:00:00.000Z');
    });
  });

  describe('getCalendarPeriodBounds', () => {
    it('resolves the correct calendar month even when the UTC instant is past local midnight the other way', () => {
      // 2026-10-01T02:00:00Z is still Sep 30, 22:00 in America/Detroit (EDT, UTC-4) — the exact
      // "midnight boundary" class of bug the org-timezone requirement exists to avoid.
      const { start, end } = getCalendarPeriodBounds('month', new Date('2026-10-01T02:00:00.000Z'), TZ);
      expect(start.toISOString()).toBe('2026-09-01T04:00:00.000Z');
      expect(end.toISOString()).toBe('2026-10-01T03:59:59.999Z');
    });

    it('resolves quarter and year bounds', () => {
      const quarter = getCalendarPeriodBounds('quarter', new Date('2026-05-15T12:00:00.000Z'), TZ);
      expect(quarter.start.toISOString()).toBe('2026-04-01T04:00:00.000Z');
      expect(quarter.end.toISOString()).toBe('2026-07-01T03:59:59.999Z');

      const year = getCalendarPeriodBounds('year', new Date('2026-05-15T12:00:00.000Z'), TZ);
      expect(year.start.toISOString()).toBe('2026-01-01T05:00:00.000Z');
      expect(year.end.toISOString()).toBe('2027-01-01T04:59:59.999Z');
    });
  });

  describe('normalizeToMonthlyEquivalent', () => {
    it('matches the worked example: 10 clients x $250/month', () => {
      const perClient = normalizeToMonthlyEquivalent(250, 'monthly');
      expect(perClient * 10).toBe(2500);
    });

    it('normalizes non-monthly frequencies to a monthly-equivalent run rate', () => {
      expect(normalizeToMonthlyEquivalent(900, 'quarterly')).toBe(300);
      expect(normalizeToMonthlyEquivalent(1200, 'annually')).toBe(100);
      expect(normalizeToMonthlyEquivalent(500, 'one_time')).toBe(0);
    });
  });
});
