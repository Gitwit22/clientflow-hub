import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pendingMigrations, shippedMigrations } from './migration-status';

describe('migration status', () => {
  const dir = mkdtempSync(join(tmpdir(), 'migrations-'));
  for (const name of ['20260101_a', '20260102_b', '20260103_c']) {
    mkdirSync(join(dir, name));
    writeFileSync(join(dir, name, 'migration.sql'), 'SELECT 1;');
  }
  writeFileSync(join(dir, 'migration_lock.toml'), '');

  it('lists the shipped migrations in order, ignoring other files', () => {
    expect(shippedMigrations(dir)).toEqual(['20260101_a', '20260102_b', '20260103_c']);
  });

  it('reports the ones the database has not applied', async () => {
    const db = { $queryRawUnsafe: jest.fn().mockResolvedValue([{ migration_name: '20260101_a' }]) };
    await expect(pendingMigrations(db as never, shippedMigrations(dir))).resolves.toEqual(['20260102_b', '20260103_c']);
  });

  it('ships the real migrations folder', () => {
    expect(shippedMigrations()).toContain('20261001130000_payment_idempotency');
  });
});
