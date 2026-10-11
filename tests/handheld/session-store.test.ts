// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type CachedSession,
  clearCachedSession,
  getCachedReplicaConfig,
  getCachedSession,
  getDeviceId,
  hasValidSession,
  setCachedReplicaConfig,
  setCachedSession,
  setDeviceId,
} from '#/handheld/session-store';

const session: CachedSession = {
  userId: 'u1',
  name: 'Ana',
  role: 'worker',
  deviceId: 'd1',
  expiresAt: '2026-01-08T00:00:00.000Z',
};

describe('session store', () => {
  beforeEach(() => localStorage.clear());

  it('round-trips and clears the session', () => {
    expect(getCachedSession()).toBeNull();
    setCachedSession(session);
    expect(getCachedSession()).toEqual(session);
    clearCachedSession();
    expect(getCachedSession()).toBeNull();
  });

  it('checks expiry against now', () => {
    expect(hasValidSession(new Date('2026-01-01T00:00:00Z'))).toBe(false);
    setCachedSession(session);
    expect(hasValidSession(new Date('2026-01-07T23:59:59Z'))).toBe(true);
    expect(hasValidSession(new Date('2026-01-08T00:00:00Z'))).toBe(false);
    expect(hasValidSession(new Date('2026-02-01T00:00:00Z'))).toBe(false);
  });

  it('treats a corrupt or malformed entry as no session', () => {
    localStorage.setItem('fi:session', '{not json');
    expect(getCachedSession()).toBeNull();
    localStorage.setItem('fi:session', JSON.stringify({ userId: 'u1' }));
    expect(getCachedSession()).toBeNull();
    expect(hasValidSession()).toBe(false);
  });

  it('persists the device id separately from the session', () => {
    expect(getDeviceId()).toBeNull();
    setDeviceId('dev-9');
    clearCachedSession();
    expect(getDeviceId()).toBe('dev-9');
    expect(localStorage.getItem('fi:deviceId')).toBe('dev-9');
  });

  it('caches the replica config', () => {
    expect(getCachedReplicaConfig()).toBeNull();
    const cfg = { replicas: [], staleWarningMs: 1 };
    setCachedReplicaConfig(cfg);
    expect(getCachedReplicaConfig()).toEqual(cfg);
    localStorage.setItem('fi:replicaConfig', '{"x":1}');
    expect(getCachedReplicaConfig()).toBeNull();
  });
});
