import { parseOrgDate, parseOrgDateEnd } from './billing-schedule.util';

describe('parseOrgDate', () => {
  it('reads a typed date as that calendar day in the organization, not UTC midnight', () => {
    // Detroit is UTC-4 in October: Oct 3 starts at 04:00Z (UTC midnight would be Oct 2, 8pm there).
    expect(parseOrgDate('2026-10-03', 'America/Detroit').toISOString()).toBe('2026-10-03T04:00:00.000Z');
  });

  it('takes a full timestamp as given', () => {
    expect(parseOrgDate('2026-10-01T04:00:00.000Z', 'America/Detroit').toISOString()).toBe('2026-10-01T04:00:00.000Z');
  });

  it('"through" dates cover the whole day', () => {
    expect(parseOrgDateEnd('2026-08-31', 'America/Detroit').toISOString()).toBe('2026-09-01T03:59:59.999Z');
  });
});
