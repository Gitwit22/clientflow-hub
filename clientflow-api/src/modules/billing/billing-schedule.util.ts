import { addDays, addMonths, addWeeks, getDaysInMonth, setDate } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';

export type BillingFrequency = 'one_time' | 'weekly' | 'monthly' | 'quarterly' | 'annually' | 'custom';
export type CalendarPeriodKind = 'month' | 'quarter' | 'year';

export interface BillingSchedule {
  startDate: Date;
  frequency: BillingFrequency;
  customIntervalDays?: number | null;
  defaultDueDay?: number | null;
  /** IANA timezone (e.g. "America/Detroit") that all wall-clock/calendar math is anchored to. */
  timezone: string;
}

// Safety cap on generated occurrences so a bad/ancient startDate can't spin an unbounded loop.
const MAX_OCCURRENCES = 10_000;
const AVG_DAYS_PER_MONTH = 30.44;

function toOrgWallClock(date: Date, timezone: string): Date {
  return toZonedTime(date, timezone);
}

function fromOrgWallClock(wallClock: Date, timezone: string): Date {
  return fromZonedTime(wallClock, timezone);
}

/**
 * A date typed by staff ("2026-10-03") means that calendar day where the organization is, not UTC
 * midnight (which is the previous evening in US timezones). Full timestamps are taken as given.
 */
export function parseOrgDate(value: string, timezone: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return fromZonedTime(`${value}T00:00:00`, timezone);
  return new Date(value);
}

/** Like parseOrgDate, but a bare date means the end of that day ("paid through Aug 31" includes the 31st). */
export function parseOrgDateEnd(value: string, timezone: string): Date {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(parseOrgDate(value, timezone).getTime() + 86_400_000 - 1);
  return new Date(value);
}

function applyDueDay(wallClock: Date, dueDay: number | null | undefined): Date {
  if (!dueDay) return wallClock;
  const clamped = Math.min(Math.max(Math.trunc(dueDay), 1), getDaysInMonth(wallClock));
  return setDate(wallClock, clamped);
}

/** Yields each occurrence's org-timezone wall-clock instant, ascending, capped at MAX_OCCURRENCES. */
function* iterateWallClockOccurrences(schedule: BillingSchedule): Generator<Date> {
  const startWallClock = toOrgWallClock(schedule.startDate, schedule.timezone);

  if (schedule.frequency === 'one_time') {
    yield startWallClock;
    return;
  }

  if (schedule.frequency === 'weekly') {
    for (let i = 0; i < MAX_OCCURRENCES; i += 1) yield addWeeks(startWallClock, i);
    return;
  }

  if (schedule.frequency === 'custom') {
    const step = Math.max(1, Math.trunc(schedule.customIntervalDays ?? 30));
    for (let i = 0; i < MAX_OCCURRENCES; i += 1) yield addDays(startWallClock, i * step);
    return;
  }

  const monthsPerPeriod = schedule.frequency === 'monthly' ? 1 : schedule.frequency === 'quarterly' ? 3 : 12;
  const anchor = applyDueDay(startWallClock, schedule.defaultDueDay);
  // If the due-day rule pushes the first occurrence before the actual start, the real first
  // obligation is the following period instead (e.g. start on the 15th, due-day fixed to the 1st).
  const first = anchor < startWallClock ? addMonths(anchor, monthsPerPeriod) : anchor;
  for (let i = 0; i < MAX_OCCURRENCES; i += 1) {
    yield applyDueDay(addMonths(first, i * monthsPerPeriod), schedule.defaultDueDay);
  }
}

/** Inclusive on both ends. Occurrences are returned as real UTC instants. */
export function computeOccurrences(schedule: BillingSchedule, rangeStart: Date, rangeEnd: Date): Date[] {
  const results: Date[] = [];
  for (const wallClock of iterateWallClockOccurrences(schedule)) {
    const occurrence = fromOrgWallClock(wallClock, schedule.timezone);
    if (occurrence > rangeEnd) break;
    if (occurrence >= rangeStart) results.push(occurrence);
  }
  return results;
}

/** Earliest occurrence on or after `after` (defaults to now), or null once a one_time schedule has passed. */
export function computeNextDueDate(schedule: BillingSchedule, after: Date = new Date()): Date | null {
  for (const wallClock of iterateWallClockOccurrences(schedule)) {
    const occurrence = fromOrgWallClock(wallClock, schedule.timezone);
    if (occurrence >= after) return occurrence;
  }
  return null;
}

/**
 * Monthly-equivalent run-rate for the "Active recurring revenue" dashboard figure only —
 * every other calculation (Expected/Received/Outstanding) uses literal per-period occurrences.
 */
export function normalizeToMonthlyEquivalent(
  amount: number,
  frequency: BillingFrequency,
  customIntervalDays?: number | null,
): number {
  switch (frequency) {
    case 'weekly':
      return amount * (AVG_DAYS_PER_MONTH / 7);
    case 'monthly':
      return amount;
    case 'quarterly':
      return amount / 3;
    case 'annually':
      return amount / 12;
    case 'custom':
      return amount * (AVG_DAYS_PER_MONTH / Math.max(1, customIntervalDays ?? 30));
    case 'one_time':
      return 0;
    default:
      return 0;
  }
}

/**
 * The [start, end] (inclusive) window a given due-date occurrence belongs to — used to tag
 * payments with the obligation they're applied to, and to detect whether a period is already paid.
 */
export function getPeriodBoundsForOccurrence(schedule: BillingSchedule, occurrence: Date): { start: Date; end: Date } {
  if (schedule.frequency === 'monthly') return getCalendarPeriodBounds('month', occurrence, schedule.timezone);
  if (schedule.frequency === 'quarterly') return getCalendarPeriodBounds('quarter', occurrence, schedule.timezone);
  if (schedule.frequency === 'annually') return getCalendarPeriodBounds('year', occurrence, schedule.timezone);
  if (schedule.frequency === 'weekly') {
    return { start: occurrence, end: new Date(addDays(occurrence, 7).getTime() - 1) };
  }
  if (schedule.frequency === 'custom') {
    const step = Math.max(1, Math.trunc(schedule.customIntervalDays ?? 30));
    return { start: occurrence, end: new Date(addDays(occurrence, step).getTime() - 1) };
  }
  return { start: occurrence, end: occurrence };
}

/** Calendar month/quarter/year bounds (inclusive end) in the organization's timezone. */
export function getCalendarPeriodBounds(
  kind: CalendarPeriodKind,
  referenceDate: Date,
  timezone: string,
): { start: Date; end: Date } {
  const wallClock = toOrgWallClock(referenceDate, timezone);
  const year = wallClock.getFullYear();
  const month = wallClock.getMonth();
  let startMonth = month;
  let span = 1;
  if (kind === 'quarter') {
    startMonth = Math.floor(month / 3) * 3;
    span = 3;
  } else if (kind === 'year') {
    startMonth = 0;
    span = 12;
  }
  const startWallClock = new Date(year, startMonth, 1, 0, 0, 0, 0);
  const endWallClockExclusive = new Date(year, startMonth + span, 1, 0, 0, 0, 0);
  return {
    start: fromOrgWallClock(startWallClock, timezone),
    end: new Date(fromOrgWallClock(endWallClockExclusive, timezone).getTime() - 1),
  };
}
