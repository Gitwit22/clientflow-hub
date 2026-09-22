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
  return config.get('JWT_ACCESS_SECRET', { infer: true }) ?? 'development-clientflow-secret';
}

function getCookieValue(request: Request, name: string): string | undefined {
  const raw = request.headers.cookie ?? '';
  for (const chunk of raw.split(';')) {
    const [key, ...rest] = chunk.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

/**
 * Verifies the same JWT session cookie/bearer token issued by the compatibility login route.
 * Falls back to unauthenticated access only while the temporary ALLOW_UNAUTHENTICATED_* flags
 * are enabled (never true in production, per environment validation).
 */
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

    if (!token) {
      if (this.bypassAllowed()) return true;
      throw new UnauthorizedException('Missing authenticated session.');
    }

    let payload: Record<string, unknown> & { sub?: string; organizationId?: string };
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

  private bypassAllowed(): boolean {
    return (
      this.config.get('ALLOW_UNAUTHENTICATED_CLIENT_CREATION', { infer: true }) === 'true'
      || this.config.get('ALLOW_UNAUTHENTICATED_CONTRACT_MANAGEMENT', { infer: true }) === 'true'
    );
  }
}

/** Must run after ClientflowAuthGuard. Only blocks when a real session is present and non-admin. */
@Injectable()
export class ClientflowAdminOnlyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (request.adminUser && !ADMIN_ROLES.includes(request.adminUser.role)) {
      throw new ForbiddenException('Only organization admins can perform this action.');
    }
    return true;
  }
}
