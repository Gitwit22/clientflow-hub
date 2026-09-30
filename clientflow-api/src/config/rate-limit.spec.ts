import { Controller, Get, Post } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { SkipThrottle, Throttle, ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { SIGN_IN_LIMIT } from '../modules/compatibility/compatibility.controller';

@Controller()
class ProbeController {
  @Throttle(SIGN_IN_LIMIT) @Post('login') login() { return { ok: true }; }
  @Get('page') page() { return { ok: true }; }
}

@SkipThrottle()
@Controller('health')
class HealthProbe {
  @Get('live') live() { return { ok: true }; }
}

describe('rate limits', () => {
  let app: NestExpressApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [ThrottlerModule.forRoot([{ ttl: 60_000, limit: 600 }])],
      controllers: [ProbeController, HealthProbe],
      providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    app.set('trust proxy', 1);
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });
  afterAll(() => app.close());

  const hit = (path: string, ip: string, method = 'GET') =>
    fetch(`${base}${path}`, { method, headers: { 'x-forwarded-for': ip } }).then((response) => response.status);

  it('allows 10 sign-in attempts a minute per visitor, then refuses', async () => {
    const statuses: number[] = [];
    for (let i = 0; i < 11; i += 1) statuses.push(await hit('/login', '203.0.113.5', 'POST'));
    expect(statuses.slice(0, 10).every((status) => status === 201)).toBe(true);
    expect(statuses[10]).toBe(429);
  });

  it('counts each visitor separately behind the proxy', async () => {
    expect(await hit('/login', '203.0.113.99', 'POST')).toBe(201);
  });

  it('lets a normal page load (60+ calls) through and never limits health checks', async () => {
    for (let i = 0; i < 80; i += 1) expect(await hit('/page', '198.51.100.7')).toBe(200);
    for (let i = 0; i < 700; i += 1) {
      const status = await hit('/health/live', '198.51.100.8');
      if (status !== 200) throw new Error(`health was limited at call ${i}`);
    }
  });
});
