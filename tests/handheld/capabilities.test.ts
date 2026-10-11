import { describe, expect, it } from 'vitest';
import { checkCapabilities } from '#/handheld/capabilities';

const full = {
  crossOriginIsolated: true,
  SharedArrayBuffer: class {},
  BroadcastChannel: class {},
  navigator: { storage: { getDirectory: () => {} }, locks: {} },
};

describe('checkCapabilities', () => {
  it('is ok when everything is present', () => {
    expect(checkCapabilities(full)).toEqual({ ok: true, missing: [] });
  });

  it('lists exactly the missing features', () => {
    const r = checkCapabilities({
      ...full,
      crossOriginIsolated: false,
      navigator: { storage: {} },
    });
    expect(r.ok).toBe(false);
    expect(r.missing).toEqual(['crossOriginIsolated', 'OPFS', 'WebLocks']);
  });

  it('reports everything on an empty env', () => {
    expect(checkCapabilities({}).missing).toEqual([
      'crossOriginIsolated',
      'SharedArrayBuffer',
      'OPFS',
      'WebLocks',
      'BroadcastChannel',
    ]);
  });
});
