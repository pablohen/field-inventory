import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionClaims } from '#/server/auth/session';
import type { SyncDeps } from '#/server/sync/sync-movements';
import { defaultDeps, handleSync } from '#/server/sync/sync-movements.server';
import { createTestEnv, type TestEnv } from '../support/test-env';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('defaultDeps', () => {
  it('uses the defaults when the env vars are unset', () => {
    vi.stubEnv('CLOCK_SKEW_THRESHOLD_MS', '');
    vi.stubEnv('TRANSFER_STUCK_HOURS', '');
    const deps = defaultDeps();
    expect(deps.clockSkewThresholdMs).toBe(120000);
    expect(deps.transferStuckHours).toBe(24);
  });

  it('honours env overrides', () => {
    vi.stubEnv('CLOCK_SKEW_THRESHOLD_MS', '5000');
    vi.stubEnv('TRANSFER_STUCK_HOURS', '48');
    const deps = defaultDeps();
    expect(deps.clockSkewThresholdMs).toBe(5000);
    expect(deps.transferStuckHours).toBe(48);
  });

  it('falls back to defaults for non-numeric values', () => {
    vi.stubEnv('CLOCK_SKEW_THRESHOLD_MS', 'abc');
    vi.stubEnv('TRANSFER_STUCK_HOURS', 'Infinity');
    const deps = defaultDeps();
    expect(deps.clockSkewThresholdMs).toBe(120000);
    expect(deps.transferStuckHours).toBe(24);
  });
});

describe('handleSync', () => {
  let env: TestEnv;
  let deps: SyncDeps;
  beforeEach(async () => {
    env = await createTestEnv();
    await env.seedUser({ id: 'u1', username: 'u1', pin: '1234' });
    deps = { global: env.global } as SyncDeps;
  });
  afterEach(async () => {
    await env.cleanup();
  });
  const session: SessionClaims = {
    userId: 'u1',
    deviceId: 'd',
    role: 'worker',
    exp: 0,
  };

  it('maps an invalid envelope to a 400 Response', async () => {
    const thrown = await handleSync(deps, { nope: true }, session).catch(
      (e) => e,
    );
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(400);
    const body = await (thrown as Response).json();
    expect(body.error).toBe('Invalid sync envelope');
  });

  it('propagates other errors unchanged', async () => {
    const boom = new Error('boom');
    const failing = {
      global: env.global,
      get now(): never {
        throw boom;
      },
    } as unknown as SyncDeps;
    const valid = {
      deviceId: 'd',
      schemaVersion: 1,
      sentAt: '2026-03-01T12:00:00Z',
      movements: [],
    };
    await expect(handleSync(failing, valid, session)).rejects.toBe(boom);
  });

  it('throws a 403 Response when the session is for another device', async () => {
    const batch = {
      deviceId: 'd',
      schemaVersion: 1,
      sentAt: '2026-03-01T12:00:00Z',
      movements: [],
    };
    const thrown = await handleSync(deps, batch, {
      ...session,
      deviceId: 'other',
    }).catch((e) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(403);
    expect(await (thrown as Response).json()).toEqual({
      error: 'Session device mismatch',
    });
  });
});
