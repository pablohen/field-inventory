export interface WarehouseProvisioner {
  ensureDatabase(dbName: string): Promise<void>;
}

/** Creates warehouse databases through the Turso Platform API. 409 (exists) is success. */
export function tursoProvisioner(
  env: { org: string; platformToken: string; group: string },
  fetchFn: typeof fetch = fetch,
): WarehouseProvisioner {
  return {
    async ensureDatabase(dbName) {
      const res = await fetchFn(
        `https://api.turso.tech/v1/organizations/${encodeURIComponent(env.org)}/databases`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.platformToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: dbName, group: env.group }),
        },
      );
      if (res.ok || res.status === 409) return;
      throw new Error(
        `Turso database create failed for ${dbName}: HTTP ${res.status}`,
      );
    },
  };
}

/** Local file databases are created on first connect. */
export function fileProvisioner(): WarehouseProvisioner {
  return { async ensureDatabase() {} };
}

/** Turso when `WAREHOUSE_DB_URL_TEMPLATE` is a libsql:// URL, otherwise local files. */
export function defaultProvisioner(): WarehouseProvisioner {
  const template = process.env.WAREHOUSE_DB_URL_TEMPLATE ?? '';
  if (!template.startsWith('libsql://')) return fileProvisioner();
  const org = process.env.TURSO_ORG;
  const platformToken = process.env.TURSO_PLATFORM_TOKEN;
  if (!org || !platformToken) {
    return {
      async ensureDatabase() {
        throw new Error('Turso provisioning is not configured');
      },
    };
  }
  return tursoProvisioner({
    org,
    platformToken,
    group: process.env.TURSO_GROUP || 'default',
  });
}
