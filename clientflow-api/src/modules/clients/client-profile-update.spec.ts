import { BadRequestException } from '@nestjs/common';
import { buildClientProfileUpdate } from './client-profile-update';

describe('buildClientProfileUpdate', () => {
  it('persists every field the frontend legitimately sends', () => {
    const data = buildClientProfileUpdate({
      // EditClientDialog
      businessName: 'Acme',
      primaryContactName: 'Jo',
      email: 'jo@acme.test',
      phone: '555',
      website: 'https://acme.test',
      profileType: 'business',
      relationshipType: 'client',
      status: 'Active',
      assignedUserId: 'user-1',
      assignedStaff: 'Jordan Lee',
      nextFollowUpDate: '2026-10-01',
      // archive / restore / convert
      isArchived: true,
      archiveReason: 'Done',
      finalStatus: 'Archived',
      archivedAt: '2026-09-28T12:00:00.000Z',
      convertedAt: '2026-09-28T12:00:00.000Z',
    });

    expect(data).toMatchObject({
      businessName: 'Acme',
      primaryContactName: 'Jo',
      email: 'jo@acme.test',
      phone: '555',
      website: 'https://acme.test',
      profileType: 'business',
      relationshipType: 'client',
      status: 'Active',
      assignedUserId: 'user-1',
      assignedStaff: 'Jordan Lee',
      isArchived: true,
      archiveReason: 'Done',
      finalStatus: 'Archived',
    });
    expect(data.nextFollowUpDate).toEqual(new Date('2026-10-01'));
    expect(data.archivedAt).toEqual(new Date('2026-09-28T12:00:00.000Z'));
    expect(data.convertedAt).toEqual(new Date('2026-09-28T12:00:00.000Z'));
  });

  it('turns a cleared date (empty string from the edit dialog) and explicit nulls into null', () => {
    expect(buildClientProfileUpdate({ nextFollowUpDate: '', website: null, assignedUserId: null })).toEqual({
      nextFollowUpDate: null,
      website: null,
      assignedUserId: null,
    });
  });

  it('ignores undefined values (JSON drops them) and returns an empty update for an empty body', () => {
    expect(buildClientProfileUpdate({ status: undefined, archiveReason: undefined })).toEqual({});
    expect(buildClientProfileUpdate({})).toEqual({});
  });

  it.each([
    ['organizationId', 'org-evil'],
    ['id', 'client-2'],
    ['isDemo', true],
    ['programId', 'program-1'],
    ['source', 'x'],
    ['intake', { businessDescription: 'overwritten' }],
    ['socialLinks', ['https://x.test']],
    ['snapchat', {}],
    ['createdAt', '2020-01-01'],
    ['updatedAt', '2020-01-01'],
  ])('rejects %s instead of passing it to the database', (field, value) => {
    expect(() => buildClientProfileUpdate({ businessName: 'Acme', [field]: value })).toThrow(
      new BadRequestException(`These fields cannot be updated on a client: ${field}.`),
    );
  });

  it('names every rejected field', () => {
    expect(() => buildClientProfileUpdate({ organizationId: 'a', isDemo: true })).toThrow(
      'These fields cannot be updated on a client: organizationId, isDemo.',
    );
  });

  it('rejects wrong types', () => {
    expect(() => buildClientProfileUpdate({ businessName: 42 })).toThrow('businessName must be a string.');
    expect(() => buildClientProfileUpdate({ website: 42 })).toThrow('website must be a string or null.');
    expect(() => buildClientProfileUpdate({ isArchived: 'yes' })).toThrow('isArchived must be true or false.');
    expect(() => buildClientProfileUpdate({ nextFollowUpDate: 'not a date' })).toThrow(
      'nextFollowUpDate must be a valid date.',
    );
    expect(() => buildClientProfileUpdate(null)).toThrow('A JSON object body is required.');
    expect(() => buildClientProfileUpdate([])).toThrow('A JSON object body is required.');
  });

  it('keeps the workflow-status and lifecycle guards', () => {
    expect(() => buildClientProfileUpdate({ status: 'ONBOARDING' })).toThrow(
      'Client workflow statuses cannot be changed through the generic update endpoint.',
    );
    expect(() => buildClientProfileUpdate({ lifecycleStatus: 'active' })).toThrow(
      'Client lifecycle state cannot be changed through the generic update endpoint.',
    );
  });
});
