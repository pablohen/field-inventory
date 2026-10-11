import type { ReplicaConfig } from '#/server/replicas/replica-config.fn';

export const TOKEN_REFRESH_WINDOW_MS = 24 * 3600_000;

export type Blocked = 'needs_sign_in' | 'device_revoked' | 'device_unknown';

export interface ConfigManagerDeps {
  /** Calls the server; HTTP failures must throw an error with a numeric `status`. */
  fetchConfig(): Promise<unknown>;
  getCached(): ReplicaConfig | null;
  setCached(cfg: ReplicaConfig): void;
  hasSession(): boolean;
  online(): boolean;
  now(): Date;
}

function isConfig(v: unknown): v is ReplicaConfig {
  return (
    typeof v === 'object' &&
    v !== null &&
    Array.isArray((v as ReplicaConfig).replicas)
  );
}

function blockedFor(err: unknown): Blocked | null {
  const status = (err as { status?: unknown } | null)?.status;
  if (status === 401) return 'needs_sign_in';
  if (status === 403) {
    try {
      const body = JSON.parse((err as Error).message) as { error?: unknown };
      if (body.error === 'DEVICE_REVOKED') return 'device_revoked';
      if (body.error === 'DEVICE_UNKNOWN') return 'device_unknown';
    } catch {
      // unparseable 403: treat as a bad session
    }
    return 'needs_sign_in';
  }
  return null;
}

/**
 * Owns the replica config: loads it (cache fallback only for network errors
 * and 5xx), renews tokens near expiry, and records an auth/revocation block.
 * While blocked it never calls the server from `getToken` and keeps serving
 * cached tokens for local reads.
 */
export function createConfigManager(deps: ConfigManagerDeps) {
  let config: ReplicaConfig | null = null;
  let blocked: Blocked | null = null;
  let refreshing: Promise<void> | null = null;

  /** One fetch attempt; updates `config` and `blocked`. Never throws. */
  async function load(): Promise<ReplicaConfig | null> {
    if (deps.online() && deps.hasSession()) {
      try {
        const fresh = await deps.fetchConfig();
        if (isConfig(fresh)) {
          deps.setCached(fresh);
          config = fresh;
          blocked = null;
          return config;
        }
      } catch (err) {
        const b = blockedFor(err);
        if (b) blocked = b;
        // TypeError, 5xx and anything else: fall back to the cache
      }
    }
    config ??= deps.getCached();
    return config;
  }

  function refresh(): Promise<void> {
    refreshing ??= load()
      .then(() => {})
      .finally(() => {
        refreshing = null;
      });
    return refreshing;
  }

  return {
    load,
    get blocked(): Blocked | null {
      return blocked;
    },
    get config(): ReplicaConfig | null {
      return config;
    },
    /** Token for a replica; renews first when online and within 24 h of expiry. */
    async getToken(name: string): Promise<string> {
      const find = () => config?.replicas.find((r) => r.name === name);
      const cur = find();
      const nearExpiry =
        !cur ||
        Date.parse(cur.expiresAt) - deps.now().getTime() <
          TOKEN_REFRESH_WINDOW_MS;
      if (
        nearExpiry &&
        blocked === null &&
        deps.online() &&
        deps.hasSession()
      ) {
        await refresh(); // a failed refresh keeps the old token
      }
      const t = find();
      if (!t) throw new Error(`No token for replica ${name}`);
      return t.token;
    },
  };
}

export type ConfigManager = ReturnType<typeof createConfigManager>;
