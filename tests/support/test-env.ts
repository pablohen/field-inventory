import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { type Client, createClient } from '@libsql/client';
import {
  type CatalogClient,
  closeClients,
  createCatalogClient,
  createGlobalClient,
  createWarehouseClient,
  type GlobalClient,
  type WarehouseClient,
} from '#/server/db/clients';
import {
  applyMigrations,
  type DbName,
  migrationsDir,
  SCHEMA_VERSIONS,
} from '#/server/db/migrate';

export interface TestEnv {
  global: GlobalClient;
  catalog: CatalogClient;
  warehouse(name: string): Promise<WarehouseClient>;
  seedWarehouse(name: string): Promise<void>;
  seedDevice(opts: {
    id: string;
    warehouses: string[];
    revoked?: boolean;
  }): Promise<void>;
  seedProduct(opts: {
    id: string;
    sku: string;
    countTolerance?: number;
    categoryTolerance?: number;
  }): Promise<void>;
  seedLocation(
    warehouse: string,
    opts: { id: string; code: string; active?: boolean },
  ): Promise<void>;
  seedPickLine(
    warehouse: string,
    opts: {
      id: string;
      skuId: string;
      locationId: string;
      qtyRequested: number;
    },
  ): Promise<void>;
  cleanup(): Promise<void>;
}

async function migrateFile(url: string, name: DbName) {
  const client: Client = createClient({ url });
  try {
    await applyMigrations(client, migrationsDir(name));
  } finally {
    client.close();
  }
}

const ENV_KEYS = [
  'GLOBAL_DB_URL',
  'CATALOG_DB_URL',
  'WAREHOUSE_DB_URL_TEMPLATE',
] as const;

export async function createTestEnv(): Promise<TestEnv> {
  const dir = mkdtempSync(join(tmpdir(), 'fi-test-'));
  const previous = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  const globalUrl = `file:${dir}/global.db`;
  const catalogUrl = `file:${dir}/catalog.db`;
  process.env.GLOBAL_DB_URL = globalUrl;
  process.env.CATALOG_DB_URL = catalogUrl;
  process.env.WAREHOUSE_DB_URL_TEMPLATE = `file:${dir}/{name}.db`;

  await migrateFile(globalUrl, 'global');
  await migrateFile(catalogUrl, 'catalog');

  const global = createGlobalClient(globalUrl);
  const catalog = createCatalogClient(catalogUrl);
  const warehouses = new Map<string, WarehouseClient>();

  async function warehouse(name: string): Promise<WarehouseClient> {
    let client = warehouses.get(name);
    if (!client) {
      const url = `file:${dir}/${name}.db`;
      await migrateFile(url, 'warehouse');
      client = createWarehouseClient(url);
      warehouses.set(name, client);
    }
    return client;
  }

  async function seedWarehouse(name: string) {
    await warehouse(name);
    await global.warehouse.upsert({
      where: { id: name },
      create: {
        id: name,
        name,
        tursoDbName: name,
        schemaVersion: SCHEMA_VERSIONS.warehouse,
      },
      update: { schemaVersion: SCHEMA_VERSIONS.warehouse },
    });
  }

  return {
    global,
    catalog,
    warehouse,
    seedWarehouse,

    async seedDevice({ id, warehouses: whs, revoked }) {
      await global.device.create({
        data: { id, label: id, revokedAt: revoked ? new Date() : null },
      });
      for (const wh of whs) {
        await seedWarehouse(wh);
        await global.deviceWarehouse.create({
          data: { deviceId: id, warehouseId: wh },
        });
      }
    },

    async seedProduct({ id, sku, countTolerance, categoryTolerance }) {
      let categoryId: string | undefined;
      if (categoryTolerance !== undefined) {
        categoryId = `cat-${id}`;
        await catalog.productCategory.create({
          data: {
            id: categoryId,
            name: categoryId,
            countTolerance: categoryTolerance,
          },
        });
      }
      await catalog.product.create({
        data: { id, sku, name: sku, countTolerance, categoryId },
      });
    },

    async seedLocation(wh, { id, code, active }) {
      await (await warehouse(wh)).location.create({
        data: { id, code, active: active ?? true },
      });
    },

    async seedPickLine(wh, { id, skuId, locationId, qtyRequested }) {
      const db = await warehouse(wh);
      const pickListId = `pl-${id}`;
      await db.pickList.create({
        data: { id: pickListId, status: 'OPEN', createdBy: 'system' },
      });
      await db.pickLine.create({
        data: { id, pickListId, skuId, locationId, qtyRequested },
      });
    },

    async cleanup() {
      await Promise.all([
        global.$disconnect(),
        catalog.$disconnect(),
        ...[...warehouses.values()].map((c) => c.$disconnect()),
      ]);
      warehouses.clear();
      await closeClients();
      for (const k of ENV_KEYS) {
        if (previous[k] === undefined) delete process.env[k];
        else process.env[k] = previous[k];
      }
      await rm(dir, { recursive: true, force: true });
    },
  };
}
