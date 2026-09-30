import { ServiceUnavailableException } from '@nestjs/common';
import { HealthController } from './health.controller';

describe('HealthController.ready', () => {
  const controller = (applied: string[]) =>
    new HealthController({
      $queryRawUnsafe: jest.fn().mockResolvedValue(applied.map((migration_name) => ({ migration_name }))),
    } as never);

  it('names the missing migrations in the message the error page shows', async () => {
    const error = await controller([]).ready().catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ServiceUnavailableException);
    const body = (error as ServiceUnavailableException).getResponse() as { message: string; pendingMigrations: string[] };
    expect(body.pendingMigrations).toContain('20261001130000_payment_idempotency');
    expect(body.message).toMatch(/^Database is missing \d+ migration\(s\): .*20261001130000_payment_idempotency.*Run npm run prisma:deploy\.$/);
  });
});
