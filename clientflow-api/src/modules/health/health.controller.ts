import { Controller, Get, Logger, OnApplicationBootstrap, ServiceUnavailableException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { pendingMigrations } from './migration-status';

@Controller('health')
export class HealthController implements OnApplicationBootstrap {
  private readonly logger = new Logger(HealthController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Get('live')
  live() {
    return {
      status: 'ok',
      service: 'clientflow-api',
      trafficEnabled: false,
      timestamp: new Date().toISOString(),
    };
  }

  /** Database reachable and every migration in this build applied (503 with the missing ones otherwise). */
  @Get('ready')
  async ready() {
    let pending: string[];
    try {
      pending = await pendingMigrations(this.prisma);
    } catch (error) {
      throw new ServiceUnavailableException({ status: 'error', database: 'unreachable', message: (error as Error).message });
    }
    if (pending.length) {
      throw new ServiceUnavailableException({ status: 'error', database: 'ok', pendingMigrations: pending });
    }
    return { status: 'ok', database: 'ok', pendingMigrations: [] };
  }

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.NODE_ENV === 'test' || !process.env.DATABASE_URL) return;
    try {
      const pending = await pendingMigrations(this.prisma);
      if (pending.length) {
        this.logger.error(
          `Database is missing ${pending.length} migration(s): ${pending.join(', ')}. `
          + 'Requests that use them will fail until `npm run prisma:deploy` runs (Render pre-deploy command).',
        );
      }
    } catch (error) {
      this.logger.warn(`Could not check database migrations: ${(error as Error).message}`);
    }
  }
}
