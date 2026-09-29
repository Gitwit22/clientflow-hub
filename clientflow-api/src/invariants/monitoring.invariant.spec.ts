import { BadRequestException, NotFoundException } from '@nestjs/common';
import {
  nextReviewAfter,
  normalizeMonitoringFrequency,
  recordMonitoringResult,
} from '../modules/lifecycle/monitoring';
import { inMemoryDb } from './in-memory-db';

/**
 * Monitoring lifecycle: a review records what the reviewer chose, keeps notes it didn't touch,
 * moves the schedule forward and leaves one history row.
 */
const ORG = 'org-a';
const reviewedOn = new Date('2026-01-31T12:00:00.000Z');

function setup(overrides: Record<string, unknown> = {}) {
  const rows = {
    cfEnrollmentMonitoring: [{
      id: 'm-1', organizationId: ORG, enrollmentId: 'e-1', name: 'Revenue check', frequency: 'monthly',
      customIntervalDays: null, complianceStatus: 'pending', notes: 'Bring bank statements.', followUpRequired: false,
      actualValue: null, expectedValue: 1000, unit: 'USD', nextReviewAt: new Date('2026-01-31T00:00:00.000Z'),
      lastReviewedAt: null, active: true, isDemo: false, ...overrides,
    }],
    cfEnrollmentMonitoringHistory: [] as Array<Record<string, unknown>>,
  };
  return { rows, db: inMemoryDb(rows) as never };
}

describe('monitoring schedule', () => {
  it.each([
    ['weekly', null, '2026-02-07T12:00:00.000Z'],
    ['monthly', null, '2026-02-28T12:00:00.000Z'], // Jan 31 + 1 month clamps to Feb 28
    ['quarterly', null, '2026-04-30T12:00:00.000Z'],
    ['annually', null, '2027-01-31T12:00:00.000Z'],
    ['custom', 14, '2026-02-14T12:00:00.000Z'],
  ])('%s moves the next review forward', (frequency, days, expected) => {
    expect(nextReviewAfter(reviewedOn, frequency, days)?.toISOString()).toBe(expected);
  });

  it('a one-time item has no next review', () => {
    expect(nextReviewAfter(reviewedOn, 'once')).toBeNull();
  });

  it('maps program labels onto stored frequencies', () => {
    expect(normalizeMonitoringFrequency('Monthly')).toEqual({ frequency: 'monthly', customIntervalDays: null });
    expect(normalizeMonitoringFrequency('Bi-weekly')).toEqual({ frequency: 'custom', customIntervalDays: 14 });
    expect(normalizeMonitoringFrequency('Yearly')).toEqual({ frequency: 'annually', customIntervalDays: null });
    expect(normalizeMonitoringFrequency(undefined).frequency).toBe('monthly');
  });
});

describe('recording a monitoring review', () => {
  it('stores the chosen result, keeps untouched notes, advances the schedule, writes history', async () => {
    const { rows, db } = setup();
    await recordMonitoringResult(db, {
      organizationId: ORG, monitoringId: 'm-1', result: { complianceStatus: 'non_compliant', actualValue: '400' }, reviewedByUserId: 'staff-1',
    }, reviewedOn);

    expect(rows.cfEnrollmentMonitoring[0]).toEqual(expect.objectContaining({
      complianceStatus: 'non_compliant',
      actualValue: 400,
      notes: 'Bring bank statements.',
      lastReviewedAt: reviewedOn,
      nextReviewAt: new Date('2026-02-28T12:00:00.000Z'),
    }));
    expect(rows.cfEnrollmentMonitoringHistory).toEqual([expect.objectContaining({
      enrollmentMonitoringId: 'm-1', enrollmentId: 'e-1', complianceStatus: 'non_compliant', reviewedByUserId: 'staff-1',
      previousValue: expect.objectContaining({ complianceStatus: 'pending' }),
      newValue: expect.objectContaining({ complianceStatus: 'non_compliant', actualValue: 400 }),
    })]);
  });

  it('accepts the older `status` field and replaces notes only when given', async () => {
    const { rows, db } = setup();
    await recordMonitoringResult(db, {
      organizationId: ORG, monitoringId: 'm-1', result: { status: 'compliant', notes: 'All good.' }, reviewedByUserId: null,
    }, reviewedOn);
    expect(rows.cfEnrollmentMonitoring[0]).toEqual(expect.objectContaining({ complianceStatus: 'compliant', notes: 'All good.' }));
  });

  it('honors an explicit next review date', async () => {
    const { rows, db } = setup();
    await recordMonitoringResult(db, {
      organizationId: ORG, monitoringId: 'm-1', result: { complianceStatus: 'compliant', nextReviewAt: '2026-06-01' }, reviewedByUserId: null,
    }, reviewedOn);
    expect(rows.cfEnrollmentMonitoring[0].nextReviewAt).toEqual(new Date('2026-06-01'));
  });

  it.each([
    ['a missing result', { notes: 'x' }, BadRequestException, {}],
    ['an unknown result', { complianceStatus: 'great' }, BadRequestException, {}],
    ['a non-numeric value', { complianceStatus: 'compliant', actualValue: 'lots' }, BadRequestException, {}],
    ['an inactive item', { complianceStatus: 'compliant' }, BadRequestException, { active: false }],
  ])('refuses %s and changes nothing', async (_label, result, error, overrides) => {
    const { rows, db } = setup(overrides);
    const before = JSON.stringify(rows);
    await expect(recordMonitoringResult(db, { organizationId: ORG, monitoringId: 'm-1', result, reviewedByUserId: null }))
      .rejects.toBeInstanceOf(error);
    expect(JSON.stringify(rows)).toBe(before);
  });

  it("another organization can't record a review (404)", async () => {
    const { rows, db } = setup();
    await expect(recordMonitoringResult(db, {
      organizationId: 'org-b', monitoringId: 'm-1', result: { complianceStatus: 'compliant' }, reviewedByUserId: null,
    })).rejects.toBeInstanceOf(NotFoundException);
    expect(rows.cfEnrollmentMonitoringHistory).toHaveLength(0);
  });
});
