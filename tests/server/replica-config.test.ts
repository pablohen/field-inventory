import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionClaims } from '#/server/auth/session';
import { replicaConfigCore } from '#/server/replicas/replica-config.fn';
import {
  type TokenMinter,
  tursoTokenMinter,
} from '#/server/replicas/token-minter';
import { createTestEnv, type TestEnv } from '../support/test-env';

describe('tursoTokenMinter', () => {
  afterEach(() => vi.useRealTimers());

  it('POSTs the exact URL with the bearer token and returns the jwt', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-11T00:00:00Z'));
    const fetchFn = vi.fn(
      async () => new Response(JSON.stringify({ jwt: 'tok' })),
    );
    const minter = tursoTokenMinter(
      { org: 'acme', platformToken: 'plat' },
      fetchFn as unknown as typeof fetch,
    );
    const out = await minter.mint('wh-1');
    expect(fetchFn).toHaveBeenCalledWith(
      'https://api.turso.tech/v1/organizations/acme/databases/wh-1/auth/tokens?expiration=7d&authorization=read-only',
      { method: 'POST', headers: { Authorization: 'Bearer plat' } },
    );
    expect(out).toEqual({
      token: 'tok',
      expiresAt: '2026-10-18T00:00:00.000Z',
    });
  });

  it('throws with status and db name on a non-2xx response', async () => {
    const fetchFn = vi.fn(async () => new Response('no', { status: 403 }));
    const minter = tursoTokenMinter(
      { org: 'acme', platformToken: 'plat' },
      fetchFn as unknown as typeof fetch,
    );
    await expect(minter.mint('wh-1')).rejects.toThrow(/403.*wh-1|wh-1.*403/);
  });
});

describe('replicaConfigCore', () => {
  let env: TestEnv;
  beforeEach(async () => {
    env = await createTestEnv();
    await env.seedDevice({ id: 'd1', warehouses: ['w1', 'w2'] });
    await env.seedDevice({ id: 'd2', warehouses: ['w3'] });
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('returns the catalog plus exactly the assigned warehouses', async () => {
    const minter: TokenMinter = {
      mint: async (db) => ({ token: `t-${db}`, expiresAt: 'x' }),
    };
    const session: SessionClaims = {
      userId: 'u',
      deviceId: 'd1',
      role: 'worker',
      exp: 0,
    };
    const cfg = await replicaConfigCore(
      {
        global: env.global,
        minter,
        urlFor: (n) => `libsql://${n}-org.turso.io`,
        catalogDbName: 'cat',
      },
      session,
    );
    expect(cfg.staleWarningMs).toBe(4 * 3600_000);
    expect(cfg.replicas.map((r) => r.name)).toEqual(['catalog', 'w1', 'w2']);
    for (const r of cfg.replicas) {
      expect(r.url).toMatch(/^libsql:\/\//);
      expect(r.token).toBe(`t-${r.dbName}`);
    }
    expect(cfg.replicas[0].dbName).toBe('cat');
  });
});
