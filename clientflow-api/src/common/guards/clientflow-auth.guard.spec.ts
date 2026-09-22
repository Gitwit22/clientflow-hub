import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { sign } from 'jsonwebtoken';
import type { Environment } from '../../config/env';
import type { PrismaService } from '../../prisma/prisma.service';
import { ClientflowAdminOnlyGuard, ClientflowAuthGuard } from './clientflow-auth.guard';

const SECRET = 'development-clientflow-secret';

function contextWithRequest(request: Record<string, unknown>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function config(overrides: Record<string, string> = {}): ConfigService<Environment, true> {
  const values: Record<string, string> = {
    ALLOW_UNAUTHENTICATED_CLIENT_CREATION: 'false',
    ALLOW_UNAUTHENTICATED_CONTRACT_MANAGEMENT: 'false',
    ...overrides,
  };
  return { get: jest.fn((key: string) => values[key]) } as unknown as ConfigService<Environment, true>;
}

const admin = {
  id: 'admin-1',
  email: 'jordan@example.com',
  firstName: 'Jordan',
  lastName: 'Staff',
  role: 'org_admin',
  organizationId: 'org-1',
  isActive: true,
};

describe('ClientflowAuthGuard', () => {
  it('rejects requests with no session when unauthenticated bypass is disabled', async () => {
    const guard = new ClientflowAuthGuard({} as unknown as PrismaService, config());
    const context = contextWithRequest({ headers: {} });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('allows requests with no session when a bypass flag is enabled', async () => {
    const guard = new ClientflowAuthGuard(
      {} as unknown as PrismaService,
      config({ ALLOW_UNAUTHENTICATED_CONTRACT_MANAGEMENT: 'true' }),
    );
    const context = contextWithRequest({ headers: {} });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('attaches the authenticated admin from a valid bearer token', async () => {
    const token = sign({ organizationId: 'org-1' }, SECRET, { subject: 'admin-1' });
    const prisma = { adminUser: { findUnique: jest.fn().mockResolvedValue(admin) } };
    const guard = new ClientflowAuthGuard(prisma as unknown as PrismaService, config());
    const request: Record<string, unknown> = { headers: { authorization: `Bearer ${token}` } };

    await expect(guard.canActivate(contextWithRequest(request))).resolves.toBe(true);
    expect(request.adminUser).toEqual({
      id: 'admin-1',
      email: 'jordan@example.com',
      displayName: 'Jordan Staff',
      role: 'org_admin',
      organizationId: 'org-1',
    });
  });

  it('rejects a token signed with the wrong secret', async () => {
    const token = sign({ organizationId: 'org-1' }, 'wrong-secret', { subject: 'admin-1' });
    const guard = new ClientflowAuthGuard({} as unknown as PrismaService, config());
    const request = { headers: { authorization: `Bearer ${token}` } };

    await expect(guard.canActivate(contextWithRequest(request))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the admin account is no longer active', async () => {
    const token = sign({ organizationId: 'org-1' }, SECRET, { subject: 'admin-1' });
    const prisma = { adminUser: { findUnique: jest.fn().mockResolvedValue({ ...admin, isActive: false }) } };
    const guard = new ClientflowAuthGuard(prisma as unknown as PrismaService, config());
    const request = { headers: { authorization: `Bearer ${token}` } };

    await expect(guard.canActivate(contextWithRequest(request))).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the token organizationId does not match the admin record', async () => {
    const token = sign({ organizationId: 'org-2' }, SECRET, { subject: 'admin-1' });
    const prisma = { adminUser: { findUnique: jest.fn().mockResolvedValue(admin) } };
    const guard = new ClientflowAuthGuard(prisma as unknown as PrismaService, config());
    const request = { headers: { authorization: `Bearer ${token}` } };

    await expect(guard.canActivate(contextWithRequest(request))).rejects.toBeInstanceOf(UnauthorizedException);
  });
});

describe('ClientflowAdminOnlyGuard', () => {
  it('allows an authenticated org_admin', () => {
    const guard = new ClientflowAdminOnlyGuard();
    const request = { adminUser: { role: 'org_admin' } };

    expect(guard.canActivate(contextWithRequest(request))).toBe(true);
  });

  it('rejects an authenticated non-admin role', () => {
    const guard = new ClientflowAdminOnlyGuard();
    const request = { adminUser: { role: 'reviewer' } };

    expect(() => guard.canActivate(contextWithRequest(request))).toThrow(ForbiddenException);
  });

  it('allows an unauthenticated bypass request through (already validated upstream)', () => {
    const guard = new ClientflowAdminOnlyGuard();
    const request = {};

    expect(guard.canActivate(contextWithRequest(request))).toBe(true);
  });
});
