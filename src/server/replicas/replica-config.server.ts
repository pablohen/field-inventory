import { SCHEMA_VERSIONS } from '#/domain/schema-versions';
import { assertSessionUserActive } from '#/server/auth/authorize';
import type { SessionClaims } from '#/server/auth/session';
import { type GlobalClient, globalDb, warehouseUrl } from '#/server/db/clients';
import type { ReplicaConfig } from './replica-config.fn';
import { type TokenMinter, tursoTokenMinter } from './token-minter';

export interface ReplicaConfigDeps {
  global: GlobalClient;
  minter: TokenMinter;
  urlFor(dbName: string): string;
  catalogDbName: string;
}

function forbidden(error: 'DEVICE_UNKNOWN' | 'DEVICE_REVOKED'): Response {
  return new Response(JSON.stringify({ error }), {
    status: 403,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function replicaConfigCore(
  deps: ReplicaConfigDeps,
  session: SessionClaims,
): Promise<ReplicaConfig> {
  await assertSessionUserActive(deps.global, session);
  const device = await deps.global.device.findUnique({
    where: { id: session.deviceId },
  });
  if (!device) throw forbidden('DEVICE_UNKNOWN');
  if (device.revokedAt !== null) throw forbidden('DEVICE_REVOKED');
  const allLinks = await deps.global.deviceWarehouse.findMany({
    where: { deviceId: session.deviceId },
    include: { warehouse: true },
    orderBy: { warehouseId: 'asc' },
  });
  // Same readiness notion as warehouseClientFor / sync's WAREHOUSE_NOT_READY:
  // a warehouse that isn't at the current schema gets no replica, so one bad
  // link can't fail the whole config.
  const links = allLinks.filter(
    (l) => l.warehouse.schemaVersion === SCHEMA_VERSIONS.warehouse,
  );
  const targets = [
    { name: 'catalog', dbName: deps.catalogDbName },
    ...links.map((l) => ({
      name: l.warehouseId,
      dbName: l.warehouse.tursoDbName,
    })),
  ];
  const replicas = await Promise.all(
    targets.map(async (t) => {
      const { token, expiresAt } = await deps.minter.mint(t.dbName);
      return { ...t, url: deps.urlFor(t.dbName), token, expiresAt };
    }),
  );
  return { replicas, staleWarningMs: 4 * 3600_000 };
}

function unavailable(error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

export function defaultReplicaDeps(): ReplicaConfigDeps {
  const template = process.env.WAREHOUSE_DB_URL_TEMPLATE ?? '';
  const org = process.env.TURSO_ORG;
  const platformToken = process.env.TURSO_PLATFORM_TOKEN;
  const catalogDbName = process.env.CATALOG_TURSO_DB;
  if (!template.startsWith('libsql://')) {
    throw unavailable('Replicas require Turso databases');
  }
  if (!org || !platformToken || !catalogDbName) {
    throw unavailable('Turso replica credentials are not configured');
  }
  return {
    global: globalDb(),
    minter: tursoTokenMinter({ org, platformToken }),
    urlFor: warehouseUrl,
    catalogDbName,
  };
}
