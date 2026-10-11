import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@libsql/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { warehouseUrl } from '#/server/db/clients';
import {
  applyMigrations,
  currentVersion,
  SCHEMA_VERSIONS,
} from '#/server/db/migrate';

function tmpUrl() {
  return `file:${join(mkdtempSync(join(tmpdir(), 'fi-migrate-')), 'test.db')}`;
}

describe('migrations', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('applies all migrations to an empty db and records the version', async () => {
    const client = createClient({ url: tmpUrl() });
    expect(await applyMigrations(client, 'prisma/warehouse/migrations')).toBe(
      SCHEMA_VERSIONS.warehouse,
    );
    expect(await currentVersion(client)).toBe(SCHEMA_VERSIONS.warehouse);
  });

  it('is idempotent', async () => {
    const client = createClient({ url: tmpUrl() });
    const first = await applyMigrations(client, 'prisma/warehouse/migrations');
    const second = await applyMigrations(client, 'prisma/warehouse/migrations');
    expect(second).toBe(first);
  });

  it('rolls back a file that fails partway and can be re-run once fixed', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'fi-migdir-'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, '001.sql'), 'CREATE TABLE one (id INTEGER);');
    writeFileSync(
      join(dir, '002.sql'),
      'CREATE TABLE two (id INTEGER);\nINSERT INTO nope VALUES (1);',
    );
    const client = createClient({ url: tmpUrl() });
    await expect(applyMigrations(client, dir)).rejects.toThrow();
    expect(await currentVersion(client)).toBe(1);
    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE name = 'two'",
    );
    expect(tables.rows).toHaveLength(0);

    writeFileSync(join(dir, '002.sql'), 'CREATE TABLE two (id INTEGER);');
    expect(await applyMigrations(client, dir)).toBe(2);
  });

  it('SCHEMA_VERSIONS match the number of migration files', () => {
    for (const n of ['global', 'catalog', 'warehouse'] as const) {
      expect(SCHEMA_VERSIONS[n]).toBe(
        readdirSync(`prisma/${n}/migrations`).filter((f) => f.endsWith('.sql'))
          .length,
      );
    }
  });

  it('warehouseUrl substitutes the template', () => {
    vi.stubEnv('WAREHOUSE_DB_URL_TEMPLATE', 'libsql://{name}-acme.turso.io');
    expect(warehouseUrl('wh-sp')).toBe('libsql://wh-sp-acme.turso.io');
  });

  it('warehouseUrl defaults to a local file', () => {
    vi.stubEnv('WAREHOUSE_DB_URL_TEMPLATE', '');
    expect(warehouseUrl('wh-sp')).toBe('file:.data/wh-sp.db');
  });
});
