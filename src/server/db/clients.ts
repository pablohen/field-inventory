import { PrismaLibSql } from '@prisma/adapter-libsql';
import { PrismaClient as CatalogPrisma } from '#/generated/catalog/client';
import { PrismaClient as GlobalPrisma } from '#/generated/global/client';
import { PrismaClient as WarehousePrisma } from '#/generated/warehouse/client';

export type GlobalClient = GlobalPrisma;
export type CatalogClient = CatalogPrisma;
export type WarehouseClient = WarehousePrisma;

const authToken = () => process.env.TURSO_GROUP_AUTH_TOKEN || undefined;

export function globalUrl(): string {
  return process.env.GLOBAL_DB_URL || 'file:.data/global.db';
}

export function catalogUrl(): string {
  return process.env.CATALOG_DB_URL || 'file:.data/catalog.db';
}

/** `WAREHOUSE_DB_URL_TEMPLATE` with `{name}` replaced; defaults to a local file. */
export function warehouseUrl(name: string): string {
  const template =
    process.env.WAREHOUSE_DB_URL_TEMPLATE || 'file:.data/{name}.db';
  return template.replaceAll('{name}', name);
}

export function createGlobalClient(url: string): GlobalClient {
  return new GlobalPrisma({
    adapter: new PrismaLibSql({ url, authToken: authToken() }),
  });
}

export function createCatalogClient(url: string): CatalogClient {
  return new CatalogPrisma({
    adapter: new PrismaLibSql({ url, authToken: authToken() }),
  });
}

export function createWarehouseClient(url: string): WarehouseClient {
  return new WarehousePrisma({
    adapter: new PrismaLibSql({ url, authToken: authToken() }),
  });
}

let globalClient: GlobalClient | undefined;
let catalogClient: CatalogClient | undefined;
const warehouseClients = new Map<string, WarehouseClient>();

export function globalDb(): GlobalClient {
  globalClient ??= createGlobalClient(globalUrl());
  return globalClient;
}

export function catalogDb(): CatalogClient {
  catalogClient ??= createCatalogClient(catalogUrl());
  return catalogClient;
}

/** Cached per warehouse name. */
export function warehouseDb(name: string): WarehouseClient {
  let client = warehouseClients.get(name);
  if (!client) {
    client = createWarehouseClient(warehouseUrl(name));
    warehouseClients.set(name, client);
  }
  return client;
}

/** Disconnects and forgets all cached clients (used by tests and scripts). */
export async function closeClients(): Promise<void> {
  const all = [globalClient, catalogClient, ...warehouseClients.values()];
  globalClient = undefined;
  catalogClient = undefined;
  warehouseClients.clear();
  await Promise.all(all.map((c) => c?.$disconnect()));
}
