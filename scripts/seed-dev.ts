import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';
import { hashPin } from '#/server/auth/password';
import {
  catalogDb,
  catalogUrl,
  closeClients,
  globalDb,
  globalUrl,
  warehouseDb,
  warehouseUrl,
} from '#/server/db/clients';
import {
  applyMigrations,
  type DbName,
  migrationsDir,
  SCHEMA_VERSIONS,
} from '#/server/db/migrate';
import { type SyncDeps, syncMovementsCore } from '#/server/sync/sync-movements';
import { DEV_PIN, LOCATION_CODES, PRODUCTS } from './seed-data';

const WAREHOUSES = [
  { id: 'wh-1', name: 'Warehouse 1', tursoDbName: 'fi-wh-1' },
  { id: 'wh-2', name: 'Warehouse 2', tursoDbName: 'fi-wh-2' },
];

const USERS = [
  { id: 'user-ana', username: 'ana', name: 'Ana', role: 'worker' },
  { id: 'user-bruno', username: 'bruno', name: 'Bruno', role: 'worker' },
  { id: 'user-sup', username: 'sup', name: 'Supervisor', role: 'supervisor' },
];

const CATEGORIES = [
  { id: 'cat-fasteners', name: 'Fasteners', countTolerance: 1 },
  { id: 'cat-tools', name: 'Tools', countTolerance: 0 },
];

const REASON_CODES = [
  { code: 'DAMAGED', label: 'Damaged', appliesTo: ['ADJUST'] },
  { code: 'FOUND', label: 'Found', appliesTo: ['ADJUST'] },
  { code: 'LOST', label: 'Lost', appliesTo: ['ADJUST'] },
  { code: 'COUNT_AUTO', label: 'Count reconciliation', appliesTo: ['ADJUST'] },
  { code: 'INITIAL', label: 'Initial stock', appliesTo: ['ADJUST'] },
];

const SEED_USER_ID = 'seed-user';
const SEED_DEVICE_ID = 'seed';

const locId = (wh: string, code: string) => `${wh}-${code}`;

/** Deterministic UUID (v5-style layout) so re-runs produce the same movement ids. */
function seedUuid(name: string): string {
  const h = createHash('sha1').update(`field-inventory-seed:${name}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString('hex');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
}

async function migrate(url: string, name: DbName): Promise<number> {
  if (url.startsWith('file:'))
    mkdirSync(dirname(url.slice(5)), { recursive: true });
  const client = createClient({
    url,
    authToken: process.env.TURSO_GROUP_AUTH_TOKEN || undefined,
  });
  try {
    return await applyMigrations(client, migrationsDir(name));
  } finally {
    client.close();
  }
}

/** Deterministic per-product/location quantity; null means no stock there. */
function initialQty(
  productIndex: number,
  locationIndex: number,
): number | null {
  // Product i is stocked at location i, plus every third location after it.
  if (
    locationIndex === productIndex ||
    (locationIndex + productIndex) % 3 === 0
  )
    return 10 + productIndex + locationIndex;
  return null;
}

async function main() {
  const global = globalDb();
  const catalog = catalogDb();

  await migrate(globalUrl(), 'global');
  await migrate(catalogUrl(), 'catalog');

  // Global: warehouses, users, devices
  for (const wh of WAREHOUSES) {
    await migrate(warehouseUrl(wh.tursoDbName), 'warehouse');
    await global.warehouse.upsert({
      where: { id: wh.id },
      create: { ...wh, schemaVersion: SCHEMA_VERSIONS.warehouse },
      update: { ...wh, schemaVersion: SCHEMA_VERSIONS.warehouse },
    });
  }

  for (const u of USERS) {
    const pinHash = await hashPin(DEV_PIN);
    await global.user.upsert({
      where: { id: u.id },
      create: { ...u, pinHash },
      update: { ...u, pinHash },
    });
  }

  // Seed user: its PIN is a random value that is discarded, so it cannot log in.
  const lockedHash = await hashPin(randomBytes(32).toString('hex'));
  await global.user.upsert({
    where: { id: SEED_USER_ID },
    create: {
      id: SEED_USER_ID,
      username: SEED_USER_ID,
      name: 'Seed',
      role: 'admin',
      pinHash: lockedHash,
    },
    update: { name: 'Seed', role: 'admin' },
  });

  const devices = [
    { id: 'dev-handheld-1', label: 'Dev handheld 1' },
    { id: SEED_DEVICE_ID, label: 'Seed device' },
  ];
  for (const d of devices) {
    await global.device.upsert({
      where: { id: d.id },
      create: d,
      update: { label: d.label },
    });
    for (const wh of WAREHOUSES) {
      await global.deviceWarehouse.upsert({
        where: { deviceId_warehouseId: { deviceId: d.id, warehouseId: wh.id } },
        create: { deviceId: d.id, warehouseId: wh.id },
        update: {},
      });
    }
  }

  // Catalog
  for (const c of CATEGORIES) {
    await catalog.productCategory.upsert({
      where: { id: c.id },
      create: c,
      update: c,
    });
  }
  for (const p of PRODUCTS) {
    const data = {
      sku: p.sku,
      name: p.name,
      barcodes: JSON.stringify(p.barcodes),
      categoryId: p.categoryId,
      countTolerance: p.countTolerance ?? null,
    };
    await catalog.product.upsert({
      where: { id: p.id },
      create: { id: p.id, ...data },
      update: data,
    });
  }
  for (const r of REASON_CODES) {
    const data = { label: r.label, appliesTo: JSON.stringify(r.appliesTo) };
    await catalog.reasonCode.upsert({
      where: { code: r.code },
      create: { code: r.code, ...data },
      update: data,
    });
  }

  // Warehouses: locations
  for (const wh of WAREHOUSES) {
    const db = warehouseDb(wh.tursoDbName);
    for (const code of LOCATION_CODES) {
      const id = locId(wh.id, code);
      await db.location.upsert({
        where: { id },
        create: { id, code, active: true },
        update: { code, active: true },
      });
    }
  }

  // Initial stock, through the ledger
  const deps: SyncDeps = {
    global,
    catalog,
    warehouseDb,
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    clockSkewThresholdMs: 120_000,
    transferStuckHours: 24,
  };
  const occurredAt = new Date('2026-01-01T00:00:00.000Z');
  let accepted = 0;
  let duplicates = 0;
  let failed = 0;
  for (const wh of WAREHOUSES) {
    const movements: Record<string, unknown>[] = [];
    PRODUCTS.forEach((p, pi) => {
      LOCATION_CODES.forEach((code, li) => {
        const qty = initialQty(pi, li);
        if (qty === null) return;
        movements.push({
          id: seedUuid(`initial:${wh.id}:${p.id}:${code}`),
          type: 'ADJUST',
          warehouseId: wh.id,
          skuId: p.id,
          locationId: locId(wh.id, code),
          qty,
          reasonCode: 'INITIAL',
          userId: SEED_USER_ID,
          deviceId: SEED_DEVICE_ID,
          occurredAt: occurredAt.toISOString(),
        });
      });
    });
    const res = await syncMovementsCore(deps, {
      deviceId: SEED_DEVICE_ID,
      schemaVersion: SCHEMA_VERSIONS.warehouse,
      sentAt: new Date().toISOString(),
      movements,
    });
    if (res.status !== 'ok') {
      console.error(`sync failed for ${wh.id}: ${res.status}`);
      failed++;
      continue;
    }
    for (const r of res.results) {
      if (r.status === 'accepted') accepted++;
      else if (r.status === 'duplicate') duplicates++;
      else {
        console.error(
          `invalid row ${r.id ?? '(no id)'} in ${wh.id}: ${r.reason}`,
        );
        failed++;
      }
    }
  }
  console.log(`initial stock: ${accepted} accepted, ${duplicates} duplicate`);
  if (failed > 0) {
    process.exitCode = 1;
    return;
  }

  // wh-1: pick list for ana and a count task for zone A
  const wh1 = warehouseDb(WAREHOUSES[0].tursoDbName);
  await wh1.pickList.upsert({
    where: { id: 'pl-1' },
    create: {
      id: 'pl-1',
      status: 'OPEN',
      assignedUserId: 'user-ana',
      createdBy: 'user-sup',
    },
    update: { assignedUserId: 'user-ana' },
  });
  const lines = [
    { id: 'pl-1-1', skuId: 'prod-1', code: 'A-01', qtyRequested: 3 },
    { id: 'pl-1-2', skuId: 'prod-2', code: 'A-02', qtyRequested: 2 },
    { id: 'pl-1-3', skuId: 'prod-3', code: 'A-03', qtyRequested: 4 },
  ];
  for (const l of lines) {
    const data = {
      pickListId: 'pl-1',
      skuId: l.skuId,
      locationId: locId('wh-1', l.code),
      qtyRequested: l.qtyRequested,
    };
    await wh1.pickLine.upsert({
      where: { id: l.id },
      create: { id: l.id, ...data },
      update: data,
    });
  }
  await wh1.countTask.upsert({
    where: { id: 'ct-1' },
    create: {
      id: 'ct-1',
      scope: JSON.stringify({ zone: 'A' }),
      assignedUserId: 'user-ana',
      status: 'OPEN',
    },
    update: { scope: JSON.stringify({ zone: 'A' }) },
  });

  console.log(
    `seeded: ${WAREHOUSES.length} warehouses, ${USERS.length} users, ${devices.length} devices, ${PRODUCTS.length} products, ${CATEGORIES.length} categories, ${LOCATION_CODES.length * WAREHOUSES.length} locations, ${REASON_CODES.length} reason codes, 1 pick list (${lines.length} lines), 1 count task`,
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => closeClients());
