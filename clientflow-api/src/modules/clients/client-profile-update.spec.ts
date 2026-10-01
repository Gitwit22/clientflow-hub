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
    ['snapchat', {}],
    ['createdAt', '2020-01-01'],
    ['updatedAt', '2020-01-01'],
  ])('rejects %s instead of passing it to the database', (field, value) => {
    expect(() => buildClientProfileUpdate({ businessName: 'Acme', [field]: value })).toThrow(
      new BadRequestException(`These fields cannot be updated on a client: ${field}.`),
    );
  });

  it('merges an intake patch into the current intake, keeping other keys', () => {
    const current = {
      status: 'ACTIVE',
      intake: { businessDescription: 'Old', budgetNeed: '$5k', uploadedFiles: [{ name: 'a.pdf' }], legacyKey: 'kept' },
    };
    expect(
      buildClientProfileUpdate(
        { intake: { businessDescription: '  Bakery and cafe ', budgetNeed: '', cellPhone: '555-0100', heardAboutUs: null } },
        current,
      ),
    ).toEqual({
      intake: { businessDescription: 'Bakery and cafe', cellPhone: '555-0100', uploadedFiles: [{ name: 'a.pdf' }], legacyKey: 'kept' },
    });
    expect(buildClientProfileUpdate({ intake: { workPhone: '555-0199' } }, { status: 'ACTIVE', intake: null })).toEqual({
      intake: { workPhone: '555-0199' },
    });
  });

  it('refuses intake keys that are not editable answers and non-text values', () => {
    expect(() => buildClientProfileUpdate({ intake: { uploadedFiles: [] } })).toThrow(
      'These intake answers cannot be edited on a client: uploadedFiles.',
    );
    expect(() => buildClientProfileUpdate({ intake: { programOfInterest: 'x', evil: 'y' } })).toThrow(
      'These intake answers cannot be edited on a client: programOfInterest, evil.',
    );
    expect(() => buildClientProfileUpdate({ intake: { budgetNeed: 5 } })).toThrow('intake.budgetNeed must be text.');
    expect(() => buildClientProfileUpdate({ intake: ['a'] })).toThrow('intake must be an object of intake answers.');
    expect(() => buildClientProfileUpdate({ intake: { additionalComments: 'x'.repeat(5001) } })).toThrow(
      'intake.additionalComments must be at most 5000 characters.',
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
      'That status is set by the intake and contract workflow',
    );
    expect(() => buildClientProfileUpdate({ status: 'ONBOARDING' }, { status: 'PROGRAM_SELECTED' })).toThrow(
      'That status is set by the intake and contract workflow',
    );
    // Unchanged workflow status = no change; moving out of a workflow status by hand is allowed.
    expect(buildClientProfileUpdate({ status: 'PROGRAM_SELECTED', phone: '1' }, { status: 'PROGRAM_SELECTED' })).toEqual({ phone: '1' });
    expect(buildClientProfileUpdate({ status: 'Active' }, { status: 'PROGRAM_SELECTED' })).toEqual({ status: 'Active' });
    expect(() => buildClientProfileUpdate({ lifecycleStatus: 'active' })).toThrow(
      'Client lifecycle state cannot be changed through the generic update endpoint.',
    );
  });

  it('accepts social links as openable addresses and refuses anything else', () => {
    expect(buildClientProfileUpdate({ socialLinks: [' instagram.com/eabakery ', 'https://x.com/eabakery', ''] })).toEqual({
      socialLinks: ['https://instagram.com/eabakery', 'https://x.com/eabakery'],
    });
    expect(buildClientProfileUpdate({ socialLinks: [] })).toEqual({ socialLinks: [] });
    expect(() => buildClientProfileUpdate({ socialLinks: ['@eabakery'] })).toThrow('not web addresses: @eabakery');
    expect(() => buildClientProfileUpdate({ socialLinks: ['javascript:alert(1)'] })).toThrow(BadRequestException);
    expect(() => buildClientProfileUpdate({ socialLinks: 'https://x.test' })).toThrow('list of up to 10 links');
    expect(() => buildClientProfileUpdate({ socialLinks: Array(11).fill('https://x.test') })).toThrow('list of up to 10 links');
  });
});
