import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verify as jwtVerify } from 'jsonwebtoken';
import type { Request } from 'express';
import type { Environment } from '../../config/env';
import { PrismaService } from '../../prisma/prisma.service';
import { assertSessionActive } from './session-state';

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  displayName: string;
  role: string;
  organizationId: string;
}

export type AuthenticatedRequest = Request & { adminUser?: AuthenticatedAdmin };

const ACCESS_COOKIE_NAME = process.env.NODE_ENV === 'production'
  ? '__Host-clientflow_session'
  : 'clientflow_session';
const ADMIN_ROLES = ['org_admin', 'super_admin'];

function readAccessSecret(config: ConfigService<Environment, true>): string {
  const secret = config.get('JWT_ACCESS_SECRET', { infer: true });
  // No built-in fallback: a missing secret must never let anyone sign valid sessions.
  if (!secret) throw new UnauthorizedException('Authentication is not configured.');
  return secret;
}

/**
 * The signed-in admin behind a request. The organization every query is scoped to comes from
 * here, never from a body or query string (docs/ARCHITECTURE_RULES.md).
 */
export function requireAdmin(request: AuthenticatedRequest): AuthenticatedAdmin {
  if (!request.adminUser) throw new UnauthorizedException('Missing authenticated session.');
  return request.adminUser;
}

function getCookieValue(request: Request, name: string): string | undefined {
  const raw = request.headers.cookie ?? '';
  for (const chunk of raw.split(';')) {
    const [key, ...rest] = chunk.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/** Verifies the same JWT session cookie/bearer token issued by the compatibility login route. */
@Injectable()
export class ClientflowAuthGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const bearerToken = request.headers.authorization?.startsWith('Bearer ')
      ? request.headers.authorization.slice(7)
      : undefined;
    const token = bearerToken ?? getCookieValue(request, ACCESS_COOKIE_NAME);

    if (!token) throw new UnauthorizedException('Missing authenticated session.');

    let payload: Record<string, unknown> & { sub?: string; organizationId?: string; jti?: string };
    try {
      payload = jwtVerify(token, readAccessSecret(this.config)) as typeof payload;
    } catch {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    const admin = await this.prisma.adminUser.findUnique({
      where: { id: payload.sub ?? '' },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        organizationId: true,
        isActive: true,
      },
    });
    if (!admin || !admin.isActive) {
      throw new UnauthorizedException('Authenticated session is no longer active.');
    }
    await assertSessionActive(this.prisma, payload.jti);
    if (payload.organizationId && payload.organizationId !== admin.organizationId) {
      throw new UnauthorizedException('Authenticated organization is invalid.');
    }

    request.adminUser = {
      id: admin.id,
      email: admin.email,
      displayName: [admin.firstName, admin.lastName].filter(Boolean).join(' ') || admin.email,
      role: admin.role,
      organizationId: admin.organizationId,
    };
    return true;
  }

}

/** Must run after ClientflowAuthGuard. Fails closed: no session, or a non-admin role, is refused. */
@Injectable()
export class ClientflowAdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.adminUser) throw new UnauthorizedException('Missing authenticated session.');
    if (!ADMIN_ROLES.includes(request.adminUser.role)) {
      throw new ForbiddenException('Only organization admins can perform this action.');
    }
    return true;
  }
}
