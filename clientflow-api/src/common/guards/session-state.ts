import { UnauthorizedException } from '@nestjs/common';

type SessionDb = {
  authSession: {
    findUnique(args: { where: { jti: string }; select: { revokedAt: true } }): Promise<{ revokedAt: Date | null } | null>;
  };
};

/**
 * An access token is only good while its session is live: logging out, changing or resetting the
 * password, or a newer refresh of the same session ends it at once instead of when the token
 * expires. Every session row carries the jti of its current access token.
 */
export async function assertSessionActive(db: SessionDb, jti: unknown): Promise<void> {
  if (typeof jti !== 'string' || !jti) throw new UnauthorizedException('Invalid or expired session.');
  const session = await db.authSession.findUnique({ where: { jti }, select: { revokedAt: true } });
  if (!session || session.revokedAt) throw new UnauthorizedException('Authenticated session is no longer active.');
}
