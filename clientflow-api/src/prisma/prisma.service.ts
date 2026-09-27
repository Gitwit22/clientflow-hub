import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '../generated/clientflow';

// The frontend bootstrap loads ~15 collections in parallel per page, each of which may run
// several sub-queries; Prisma's default pool (num_cpus * 2 + 1) is too small for that burst
// on a single small Render instance and causes intermittent P2024 connection-pool-timeout 500s.
function withConnectionPoolDefaults(databaseUrl: string | undefined): string | undefined {
  if (!databaseUrl) return databaseUrl;
  try {
    const url = new URL(databaseUrl);
    if (!url.searchParams.has('connection_limit')) url.searchParams.set('connection_limit', '15');
    if (!url.searchParams.has('pool_timeout')) url.searchParams.set('pool_timeout', '20');
    return url.toString();
  } catch {
    return databaseUrl;
  }
}

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor() {
    super({
      datasources: {
        db: { url: withConnectionPoolDefaults(process.env.DATABASE_URL) },
      },
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
