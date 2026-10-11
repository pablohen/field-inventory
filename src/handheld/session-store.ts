import type { Role } from '#/server/auth/session';
import type { ReplicaConfig } from '#/server/replicas/replica-config.fn';

export type CachedSession = {
  userId: string;
  name: string;
  role: Role;
  deviceId: string;
  expiresAt: string;
};

const SESSION_KEY = 'fi:session';
const DEVICE_KEY = 'fi:deviceId';
const CONFIG_KEY = 'fi:replicaConfig';

function store(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return store()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    store()?.setItem(key, value);
  } catch {
    // storage unavailable or full: callers fall back to "no cache"
  }
}

function remove(key: string): void {
  try {
    store()?.removeItem(key);
  } catch {
    // ignore
  }
}

function readJson(key: string): unknown {
  const raw = read(key);
  if (raw === null) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function getCachedSession(): CachedSession | null {
  const v = readJson(SESSION_KEY) as Partial<CachedSession> | null;
  if (
    !v ||
    typeof v.userId !== 'string' ||
    typeof v.name !== 'string' ||
    typeof v.role !== 'string' ||
    typeof v.deviceId !== 'string' ||
    typeof v.expiresAt !== 'string'
  ) {
    return null;
  }
  return v as CachedSession;
}

export function setCachedSession(s: CachedSession): void {
  write(SESSION_KEY, JSON.stringify(s));
}

export function clearCachedSession(): void {
  remove(SESSION_KEY);
}

export function hasValidSession(now: Date = new Date()): boolean {
  const s = getCachedSession();
  if (!s) return false;
  const exp = Date.parse(s.expiresAt);
  return !Number.isNaN(exp) && exp > now.getTime();
}

export function getDeviceId(): string | null {
  return read(DEVICE_KEY);
}

export function setDeviceId(id: string): void {
  write(DEVICE_KEY, id);
}

export function getCachedReplicaConfig(): ReplicaConfig | null {
  const v = readJson(CONFIG_KEY) as Partial<ReplicaConfig> | null;
  if (!v || !Array.isArray(v.replicas) || typeof v.staleWarningMs !== 'number')
    return null;
  return v as ReplicaConfig;
}

export function setCachedReplicaConfig(cfg: ReplicaConfig): void {
  write(CONFIG_KEY, JSON.stringify(cfg));
}
