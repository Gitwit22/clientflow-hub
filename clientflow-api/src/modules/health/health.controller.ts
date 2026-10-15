import {
  Controller,
  Get,
  Headers,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  Optional,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SkipThrottle } from '@nestjs/throttler';
import type { Response } from 'express';
import type { Environment } from '../../config/env';
import { N8nService } from '../../integrations/n8n/n8n.service';
import { StorageService } from '../../integrations/storage/storage.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  bearerMatches,
  configuredToken,
  emailState,
  overallHealth,
  type DependencyReport,
} from './dependency-health';
import { pendingMigrations } from './migration-status';

@SkipThrottle()
@Controller('health')
export class HealthController implements OnApplicationBootstrap {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly n8n?: N8nService,
    @Optional() private readonly storage?: StorageService,
    @Optional() private readonly config?: ConfigService<Environment, true>,
  ) {}

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
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'unreachable',
        message: `Database unreachable: ${(error as Error).message}`,
      });
    }
    if (pending.length) {
      // The error filter shows `message`; name the migrations there so the page says what to run.
      throw new ServiceUnavailableException({
        status: 'error',
        database: 'ok',
        pendingMigrations: pending,
        message: `Database is missing ${pending.length} migration(s): ${pending.join(', ')}. Run npm run prisma:deploy.`,
      });
    }
    return { status: 'ok', database: 'ok', pendingMigrations: [] };
  }

  /**
   * Dependency detail for Support Hub. Bearer-protected because it describes how ClientFlow is
   * configured; returns 404 when HEALTH_DEPENDENCIES_TOKEN is not set (the endpoint is off).
   */
  @Get('dependencies')
  async dependencies(
    @Headers('authorization') authorization: string | undefined,
    @Res({ passthrough: true }) response: Response,
  ): Promise<DependencyReport> {
    const token = configuredToken(
      this.config?.get('HEALTH_DEPENDENCIES_TOKEN', { infer: true }) ?? process.env.HEALTH_DEPENDENCIES_TOKEN,
    );
    if (!token) throw new NotFoundException();
    if (!bearerMatches(authorization, token)) throw new UnauthorizedException('A valid health token is required.');

    const report = await this.collectDependencies();
    response.setHeader('X-Health-Status', report.status);
    response.setHeader('Cache-Control', 'no-store');
    if (report.status === 'down') response.status(503);
    return report;
  }

  private async collectDependencies(): Promise<DependencyReport> {
    const since = new Date(Date.now() - 60 * 60 * 1000);
    const database: DependencyReport['dependencies']['database'] = { status: 'down' };
    let lastHour: { sent: number; failed: number } | undefined;
    const started = Date.now();
    try {
      const pending = await pendingMigrations(this.prisma);
      database.latencyMs = Date.now() - started;
      database.pendingMigrations = pending.length;
      database.status = pending.length ? 'down' : 'ok';
      // Aggregate counts across organizations: operational signal only, no client data.
      const [sent, failed] = await Promise.all([
        this.prisma.cfCommunication.count({ where: { sentAt: { gte: since } } }),
        this.prisma.cfCommunication.count({ where: { failedAt: { gte: since } } }),
      ]);
      lastHour = { sent, failed };
    } catch (error) {
      // Unreachable database leaves status 'down'; a failed count after a good check only drops lastHour.
      this.logger.warn(`Dependency health: database query failed: ${(error as Error).message}`);
    }

    const configuration = this.n8n?.getIntakeAvailability() ?? 'not_configured';
    const dependencies: DependencyReport['dependencies'] = {
      database,
      email: { status: emailState(configuration, lastHour), configuration, ...(lastHour ? { lastHour } : {}) },
      // Configuration only: probing R2 on every poll would add cost and latency for little signal.
      storage: { status: this.storage?.isEnabled() ? 'ok' : 'disabled' },
    };
    return { status: overallHealth(dependencies), checkedAt: new Date().toISOString(), dependencies };
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
