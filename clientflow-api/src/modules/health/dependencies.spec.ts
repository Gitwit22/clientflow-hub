import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Response } from 'express';
import { HealthController } from './health.controller';
import { bearerMatches, configuredToken, emailState, overallHealth } from './dependency-health';
import { shippedMigrations } from './migration-status';

const TOKEN = 'h'.repeat(40);

function makeController(options: {
  token?: string;
  migrationsApplied?: boolean;
  dbDown?: boolean;
  email?: 'ready' | 'disabled' | 'not_configured';
  sent?: number;
  failed?: number;
  storage?: boolean;
}) {
  const applied = options.migrationsApplied === false ? [] : shippedMigrations().map((migration_name) => ({ migration_name }));
  const prisma = {
    $queryRawUnsafe: options.dbDown ? jest.fn().mockRejectedValue(new Error('connect ECONNREFUSED')) : jest.fn().mockResolvedValue(applied),
    cfCommunication: {
      count: jest.fn(async ({ where }: { where: Record<string, unknown> }) => ('sentAt' in where ? options.sent ?? 0 : options.failed ?? 0)),
    },
  };
  const n8n = { getIntakeAvailability: () => options.email ?? 'ready' };
  const storage = { isEnabled: () => options.storage ?? true };
  const config = { get: (key: string) => (key === 'HEALTH_DEPENDENCIES_TOKEN' ? options.token : undefined) };
  return new HealthController(prisma as never, n8n as never, storage as never, config as never);
}

function fakeResponse() {
  const headers: Record<string, string> = {};
  let statusCode = 200;
  const response = {
    setHeader: (name: string, value: string) => { headers[name] = value; },
    status: (code: number) => { statusCode = code; return response; },
  };
  return { response: response as unknown as Response, headers, status: () => statusCode };
}

describe('GET /health/dependencies', () => {
  beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => undefined));
  afterEach(() => jest.restoreAllMocks());

  it('is off (404) without a configured token, and rejects a missing or wrong bearer', async () => {
    const res = fakeResponse();
    await expect(makeController({}).dependencies(`Bearer ${TOKEN}`, res.response)).rejects.toBeInstanceOf(NotFoundException);
    await expect(makeController({ token: 'short' }).dependencies('Bearer short', res.response)).rejects.toBeInstanceOf(NotFoundException);
    await expect(makeController({ token: TOKEN }).dependencies(undefined, res.response)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(makeController({ token: TOKEN }).dependencies(`Bearer ${'x'.repeat(40)}`, res.response)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('reports ok with a 200 when every dependency is healthy', async () => {
    const res = fakeResponse();
    const report = await makeController({ token: TOKEN, sent: 12, failed: 1 }).dependencies(`Bearer ${TOKEN}`, res.response);
    expect(report.status).toBe('ok');
    expect(res.status()).toBe(200);
    expect(res.headers['X-Health-Status']).toBe('ok');
    expect(report.dependencies).toEqual({
      database: { status: 'ok', latencyMs: expect.any(Number), pendingMigrations: 0 },
      email: { status: 'ok', configuration: 'ready', lastHour: { sent: 12, failed: 1 } },
      storage: { status: 'ok' },
    });
  });

  it('reports degraded (still 200) when most recent emails are failing', async () => {
    const res = fakeResponse();
    const report = await makeController({ token: TOKEN, sent: 1, failed: 5 }).dependencies(`Bearer ${TOKEN}`, res.response);
    expect(report.status).toBe('degraded');
    expect(report.dependencies.email.status).toBe('degraded');
    expect(res.status()).toBe(200);
    expect(res.headers['X-Health-Status']).toBe('degraded');
  });

  it('reports down with a 503 when the database is unreachable or migrations are pending', async () => {
    for (const options of [{ dbDown: true }, { migrationsApplied: false }]) {
      const res = fakeResponse();
      const report = await makeController({ token: TOKEN, ...options }).dependencies(`Bearer ${TOKEN}`, res.response);
      expect(report.status).toBe('down');
      expect(report.dependencies.database.status).toBe('down');
      expect(res.status()).toBe(503);
      expect(res.headers['X-Health-Status']).toBe('down');
    }
  });
});

describe('dependency health rules', () => {
  it('treats deliberately disabled integrations as disabled, not failing', () => {
    expect(emailState('disabled', { sent: 0, failed: 0 })).toBe('disabled');
    expect(emailState('not_configured', undefined)).toBe('down');
    expect(emailState('ready', { sent: 0, failed: 2 })).toBe('ok');
    expect(emailState('ready', { sent: 0, failed: 3 })).toBe('degraded');
    expect(emailState('ready', { sent: 10, failed: 4 })).toBe('ok');
    expect(overallHealth({ database: { status: 'ok' }, email: { status: 'disabled', configuration: 'disabled' }, storage: { status: 'disabled' } })).toBe('ok');
    expect(overallHealth({ database: { status: 'ok' }, email: { status: 'down', configuration: 'not_configured' }, storage: { status: 'ok' } })).toBe('degraded');
  });

  it('compares tokens safely', () => {
    expect(configuredToken(undefined)).toBeUndefined();
    expect(configuredToken(`  ${TOKEN}  `)).toBe(TOKEN);
    expect(bearerMatches(`Bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerMatches(`bearer ${TOKEN}`, TOKEN)).toBe(true);
    expect(bearerMatches(TOKEN, TOKEN)).toBe(false);
    expect(bearerMatches(`Bearer ${TOKEN}x`, TOKEN)).toBe(false);
  });
});
