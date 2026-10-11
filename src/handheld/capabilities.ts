export type MissingCapability =
  | 'crossOriginIsolated'
  | 'SharedArrayBuffer'
  | 'OPFS'
  | 'WebLocks'
  | 'BroadcastChannel';

/** Browser features the handheld needs; lists exactly the missing ones. */
export function checkCapabilities(env: object = globalThis): {
  ok: boolean;
  missing: MissingCapability[];
} {
  const e = env as {
    crossOriginIsolated?: boolean;
    SharedArrayBuffer?: unknown;
    BroadcastChannel?: unknown;
    navigator?: {
      storage?: { getDirectory?: unknown };
      locks?: unknown;
    };
  };
  const missing: MissingCapability[] = [];
  if (e.crossOriginIsolated !== true) missing.push('crossOriginIsolated');
  if (typeof e.SharedArrayBuffer === 'undefined')
    missing.push('SharedArrayBuffer');
  if (typeof e.navigator?.storage?.getDirectory !== 'function')
    missing.push('OPFS');
  if (!e.navigator?.locks) missing.push('WebLocks');
  if (typeof e.BroadcastChannel === 'undefined')
    missing.push('BroadcastChannel');
  return { ok: missing.length === 0, missing };
}
