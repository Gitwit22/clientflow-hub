import { createHash, timingSafeEqual } from 'node:crypto';

// Dependency health for GET /api/v1/health/dependencies (polled by Support Hub).
//
// HTTP status carries the verdict a poller can act on without parsing the body:
//   200 + X-Health-Status: ok        everything required is working
//   200 + X-Health-Status: degraded  ClientFlow serves requests but a pipeline is impaired
//   503 + X-Health-Status: down      a hard dependency (database, migrations) is failing
// The body is operational metadata only: no hostnames, secrets, organization or client data.

export const MIN_TOKEN_LENGTH = 32;
/** Email is degraded when, over the last hour, at least this many sends failed and failures outnumber successes. */
export const EMAIL_FAILURE_THRESHOLD = 3;

export type DependencyState = 'ok' | 'degraded' | 'down' | 'disabled';
export type OverallHealth = 'ok' | 'degraded' | 'down';

export interface DependencyReport {
  status: OverallHealth;
  checkedAt: string;
  dependencies: {
    database: { status: DependencyState; latencyMs?: number; pendingMigrations?: number };
    email: {
      status: DependencyState;
      configuration: 'ready' | 'disabled' | 'not_configured';
      lastHour?: { sent: number; failed: number };
    };
    storage: { status: DependencyState };
  };
}

export function overallHealth(dependencies: DependencyReport['dependencies']): OverallHealth {
  // Only the database is a hard dependency: without it no request can succeed.
  if (dependencies.database.status === 'down') return 'down';
  const states = [dependencies.database.status, dependencies.email.status, dependencies.storage.status];
  return states.some((state) => state === 'degraded' || state === 'down') ? 'degraded' : 'ok';
}

export function emailState(
  configuration: 'ready' | 'disabled' | 'not_configured',
  lastHour: { sent: number; failed: number } | undefined,
): DependencyState {
  if (configuration === 'disabled') return 'disabled';
  if (configuration === 'not_configured') return 'down';
  if (lastHour && lastHour.failed >= EMAIL_FAILURE_THRESHOLD && lastHour.failed > lastHour.sent) return 'degraded';
  return 'ok';
}

/** The configured token, or undefined when the endpoint is off (unset or too short to be safe). */
export function configuredToken(raw: string | undefined): string | undefined {
  const token = raw?.trim();
  return token && token.length >= MIN_TOKEN_LENGTH ? token : undefined;
}

/** Constant-time bearer check. Hashing first equalizes lengths for timingSafeEqual. */
export function bearerMatches(authorizationHeader: string | undefined, expected: string): boolean {
  const match = /^Bearer\s+(\S+)$/i.exec(authorizationHeader?.trim() ?? '');
  if (!match) return false;
  const digest = (value: string) => createHash('sha256').update(value).digest();
  return timingSafeEqual(digest(match[1]), digest(expected));
}
