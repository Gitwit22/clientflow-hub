import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { assertCanGrantRole, assertCanManageMember, parseRole, requireManager } from './role-policy';

const superAdmin = { id: 'super-1', role: 'super_admin' };
const orgAdmin = { id: 'admin-1', role: 'org_admin' };
const reviewer = { id: 'reviewer-1', role: 'reviewer' };

describe('role policy', () => {
  it('lets only org_admin and super_admin manage the organization', () => {
    expect(() => requireManager(superAdmin)).not.toThrow();
    expect(() => requireManager(orgAdmin)).not.toThrow();
    expect(() => requireManager(reviewer)).toThrow(ForbiddenException);
  });

  it('accepts only known roles', () => {
    expect(parseRole('reviewer')).toBe('reviewer');
    expect(() => parseRole('owner')).toThrow(BadRequestException);
    expect(() => parseRole(undefined)).toThrow(BadRequestException);
  });

  it('never lets anyone change their own role or access', () => {
    expect(() => assertCanManageMember(orgAdmin, orgAdmin)).toThrow(ForbiddenException);
    expect(() => assertCanManageMember(superAdmin, superAdmin)).toThrow(ForbiddenException);
    expect(() => assertCanManageMember(reviewer, reviewer)).toThrow(ForbiddenException);
  });

  it('lets only a super_admin grant super_admin or change another super_admin', () => {
    expect(() => assertCanGrantRole(orgAdmin, 'super_admin')).toThrow(ForbiddenException);
    expect(() => assertCanGrantRole(superAdmin, 'super_admin')).not.toThrow();
    expect(() => assertCanManageMember(orgAdmin, { id: 'super-2', role: 'super_admin' })).toThrow(ForbiddenException);
    expect(() => assertCanManageMember(superAdmin, { id: 'super-2', role: 'super_admin' })).not.toThrow();
  });

  it('never lets a reviewer grant any role', () => {
    for (const role of ['reviewer', 'org_admin', 'super_admin'] as const) {
      expect(() => assertCanGrantRole(reviewer, role)).toThrow(ForbiddenException);
    }
  });
});
