import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

type RawQuery = { $queryRawUnsafe<T = unknown>(query: string): Promise<T> };

/** The migrations this build ships with (prisma/migrations/<name>/migration.sql). */
export function shippedMigrations(directory = join(process.cwd(), 'prisma', 'migrations')): string[] {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(directory, entry.name, 'migration.sql')))
    .map((entry) => entry.name)
    .sort();
}

/**
 * Migrations in this build that the database hasn't applied. Code that reads a column a pending
 * migration adds fails on every request (a 500 with no obvious cause), so this is checked at
 * startup and shown on /health/ready.
 */
export async function pendingMigrations(db: RawQuery, shipped = shippedMigrations()): Promise<string[]> {
  const applied = await db.$queryRawUnsafe<Array<{ migration_name: string }>>(
    'SELECT migration_name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL',
  );
  const done = new Set(applied.map((row) => row.migration_name));
  return shipped.filter((name) => !done.has(name));
}
