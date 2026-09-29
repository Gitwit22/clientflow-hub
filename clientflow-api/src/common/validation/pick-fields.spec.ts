import { BadRequestException } from '@nestjs/common';
import { pickFields } from './pick-fields';

describe('pickFields', () => {
  const spec = {
    name: 'string',
    notes: 'nullableString',
    amount: 'number',
    dueAt: 'nullableDate',
    tags: 'stringArray',
    risk: { oneOf: ['low', 'high'] },
  } as const;

  it('keeps only allowlisted fields, so ownership and identity columns can never be written', () => {
    const data = pickFields(
      { name: 'Grant', organizationId: 'org-b', id: 'x', clientId: 'c', secureLinkToken: 't', isDemo: true },
      spec,
    );
    expect(data).toEqual({ name: 'Grant' });
  });

  it('converts and type-checks values', () => {
    expect(pickFields({ amount: '25', dueAt: '2026-10-01', notes: null, tags: ['a'], risk: 'low' }, spec)).toEqual({
      amount: 25,
      dueAt: new Date('2026-10-01'),
      notes: null,
      tags: ['a'],
      risk: 'low',
    });
    expect(pickFields({ dueAt: '' }, spec)).toEqual({ dueAt: null });
  });

  it('rejects wrong types instead of passing them to the database', () => {
    expect(() => pickFields({ name: 5 }, spec)).toThrow(BadRequestException);
    expect(() => pickFields({ amount: 'lots' }, spec)).toThrow(BadRequestException);
    expect(() => pickFields({ dueAt: 'not a date' }, spec)).toThrow(BadRequestException);
    expect(() => pickFields({ risk: 'extreme' }, spec)).toThrow(BadRequestException);
    expect(() => pickFields([], spec)).toThrow(BadRequestException);
  });
});
