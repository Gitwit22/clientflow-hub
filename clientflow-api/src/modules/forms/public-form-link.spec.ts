import { ConflictException, GoneException, NotFoundException } from '@nestjs/common';
import { assertPublicFormLinkUsable, resolvePublicFormLink } from './public-form-link';
import { hashPublicToken } from './intake-lifecycle';

const open = { cancelledAt: null, expiresAt: null, submittedAt: null, status: 'sent' };
const future = new Date(Date.now() + 86_400_000);
const past = new Date(Date.now() - 86_400_000);

describe('public form link rules', () => {
  it('allows viewing and submitting an open link (no expiry, or expiry in the future)', () => {
    expect(() => assertPublicFormLinkUsable(open, 'submit')).not.toThrow();
    expect(() => assertPublicFormLinkUsable({ ...open, expiresAt: future }, 'submit')).not.toThrow();
  });

  it('closes cancelled and expired links for every use', () => {
    for (const mode of ['view', 'submit'] as const) {
      expect(() => assertPublicFormLinkUsable({ ...open, cancelledAt: new Date() }, mode)).toThrow(GoneException);
      expect(() => assertPublicFormLinkUsable({ ...open, status: 'cancelled' }, mode)).toThrow(GoneException);
      expect(() => assertPublicFormLinkUsable({ ...open, status: 'expired' }, mode)).toThrow(GoneException);
      expect(() => assertPublicFormLinkUsable({ ...open, expiresAt: past }, mode)).toThrow(GoneException);
    }
  });

  it('lets a submitted form be viewed but never submitted again', () => {
    const submitted = { ...open, status: 'submitted', submittedAt: new Date() };
    expect(() => assertPublicFormLinkUsable(submitted, 'view')).not.toThrow();
    expect(() => assertPublicFormLinkUsable(submitted, 'submit')).toThrow(ConflictException);
    expect(() => assertPublicFormLinkUsable({ ...open, status: 'under_review' }, 'submit')).toThrow(ConflictException);
  });

  it('never reveals a form for an archived client or malformed token', async () => {
    const token = 'a'.repeat(43);
    const db = {
      cfFormAssignment: { findUnique: jest.fn().mockResolvedValue({ ...open, clientId: 'c1', formId: 'f1', organizationId: 'org-1' }) },
      cfClient: { findFirst: jest.fn().mockResolvedValue(null) },
      cfFormTemplate: { findFirst: jest.fn().mockResolvedValue({ id: 'f1' }) },
    };
    await expect(resolvePublicFormLink(db as never, token, 'view')).rejects.toBeInstanceOf(NotFoundException);
    expect(db.cfFormAssignment.findUnique).toHaveBeenCalledWith({ where: { secureLinkToken: hashPublicToken(token) } });
    expect(db.cfClient.findFirst).toHaveBeenCalledWith({
      where: { id: 'c1', organizationId: 'org-1', isArchived: false },
    });
    await expect(resolvePublicFormLink(db as never, 'bad token!', 'view')).rejects.toBeInstanceOf(NotFoundException);
  });
});
