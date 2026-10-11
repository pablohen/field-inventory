import { balanceKeyString, movementDeltas } from '#/domain/balance';
import { toMovement } from '#/domain/schemas';
import { listOutbox } from './outbox';
import type { Sql } from './sql';

/**
 * Reads a DATETIME column from a replica. Prisma (driver adapter) writes ISO
 * text with an offset (`2026-01-02T03:04:05.678+00:00`, verified in tests);
 * SQL defaults (`CURRENT_TIMESTAMP`) write `YYYY-MM-DD HH:MM:SS` in UTC; and
 * other writers may store epoch milliseconds as a number. All are handled.
 */
export function parseDbDate(v: unknown): Date {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw new Error('Invalid Date');
    return v;
  }
  if (typeof v === 'number' || typeof v === 'bigint') {
    const d = new Date(Number(v));
    if (!Number.isNaN(d.getTime())) return d;
    throw new Error(`Unparseable database date: ${String(v)}`);
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (/^-?\d+$/.test(s)) {
      const d = new Date(Number(s));
      if (!Number.isNaN(d.getTime())) return d;
      throw new Error(`Unparseable database date: ${String(v)}`);
    }
    // SQLite CURRENT_TIMESTAMP form has no zone: it is UTC.
    const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?$/.test(s)
      ? `${s.replace(' ', 'T')}Z`
      : s;
    const d = new Date(iso);
    if (!Number.isNaN(d.getTime())) return d;
  }
  throw new Error(`Unparseable database date: ${String(v)}`);
}

const FINISHED = ['DONE', 'CLOSED'];

type PendingMovement = ReturnType<typeof toMovement>;

/**
 * Pending outbox movements (status pending or needs_attention; corrupt rows
 * have no usable input and are skipped) for a warehouse. Rows whose id is
 * already in the replica's Movement table are skipped so a movement that has
 * synced into the replica but not yet been deleted from the outbox is never
 * counted twice.
 */
async function pendingMovements(
  replica: Sql,
  outbox: Sql,
  warehouseId: string,
): Promise<PendingMovement[]> {
  const rows = await listOutbox(outbox, { warehouseId });
  const valid = rows.flatMap((r) =>
    'corrupt' in r ? [] : [toMovement(r.input, 'device')],
  );
  if (valid.length === 0) return [];
  const present = new Set<string>();
  for (let i = 0; i < valid.length; i += 200) {
    const chunk = valid.slice(i, i + 200);
    const found = await replica.all<{ id: string }>(
      `SELECT id FROM Movement WHERE id IN (${chunk.map(() => '?').join(',')})`,
      chunk.map((m) => m.id),
    );
    for (const f of found) present.add(f.id);
  }
  return valid.filter((m) => !present.has(m.id));
}

export async function displayedStock(
  replica: Sql,
  outbox: Sql,
  warehouseId: string,
  filter: { skuId?: string; locationId?: string } = {},
): Promise<
  { skuId: string; locationId: string; qty: number; pendingDelta: number }[]
> {
  const keys = new Map<
    string,
    { skuId: string; locationId: string; base: number; pending: number }
  >();
  const entry = (skuId: string, locationId: string) => {
    const k = balanceKeyString({ skuId, locationId });
    let e = keys.get(k);
    if (!e) {
      e = { skuId, locationId, base: 0, pending: 0 };
      keys.set(k, e);
    }
    return e;
  };
  const matches = (skuId: string, locationId: string) =>
    (filter.skuId === undefined || filter.skuId === skuId) &&
    (filter.locationId === undefined || filter.locationId === locationId);

  const balances = await replica.all<{
    skuId: string;
    locationId: string;
    qty: number;
  }>('SELECT skuId, locationId, qty FROM StockBalance');
  for (const b of balances) {
    if (matches(b.skuId, b.locationId)) {
      entry(b.skuId, b.locationId).base += Number(b.qty);
    }
  }
  for (const m of await pendingMovements(replica, outbox, warehouseId)) {
    for (const d of movementDeltas(m)) {
      if (matches(d.skuId, d.locationId)) {
        entry(d.skuId, d.locationId).pending += d.delta;
      }
    }
  }
  return [...keys.values()]
    .map((e) => ({
      skuId: e.skuId,
      locationId: e.locationId,
      qty: e.base + e.pending,
      pendingDelta: e.pending,
    }))
    .sort(
      (a, b) =>
        a.skuId.localeCompare(b.skuId) ||
        a.locationId.localeCompare(b.locationId),
    );
}

/** Exact match on sku, id or any barcode; the scan is trimmed. */
export async function findProduct(
  catalog: Sql,
  scan: string,
): Promise<{ id: string; sku: string; name: string } | null> {
  const s = scan.trim();
  if (s === '') return null;
  const rows = await catalog.all<{ id: string; sku: string; name: string }>(
    `SELECT id, sku, name FROM Product
     WHERE sku = ?1 OR id = ?1
        OR (CASE WHEN json_valid(barcodes)
              THEN EXISTS (SELECT 1 FROM json_each(Product.barcodes) WHERE json_each.value = ?1)
              ELSE 0 END)
     ORDER BY (sku = ?1) DESC, (id = ?1) DESC, sku
     LIMIT 1`,
    [s],
  );
  return rows[0] ?? null;
}

/** Exact match on code or id; the scan is trimmed. Code wins over id. */
export async function findLocation(
  replica: Sql,
  scan: string,
): Promise<{ id: string; code: string; active: boolean } | null> {
  const s = scan.trim();
  if (s === '') return null;
  const rows = await replica.all<{
    id: string;
    code: string;
    active: number | boolean;
  }>(
    `SELECT id, code, active FROM Location WHERE code = ?1 OR id = ?1
     ORDER BY (code = ?1) DESC LIMIT 1`,
    [s],
  );
  const r = rows[0];
  return r
    ? { id: r.id, code: r.code, active: Boolean(Number(r.active)) }
    : null;
}

export type AssignedPickLine = {
  id: string;
  skuId: string;
  locationId: string;
  qtyRequested: number;
  pickedQty: number;
};
export type AssignedPickList = {
  id: string;
  status: string;
  createdAt: Date;
  lines: AssignedPickLine[];
};

/**
 * Active (status not DONE/CLOSED) pick lists assigned to the user. `pickedQty`
 * = replica PICK movements with ref = line id, plus pending PICKs in the
 * `outbox` (omit `outbox` to count only synced picks). The warehouse id for
 * pending rows is not known here, so every non-corrupt outbox PICK is
 * considered; line ids are unique so this cannot cross-count.
 */
export async function assignedPickLists(
  replica: Sql,
  userId: string,
  outbox?: Sql,
): Promise<AssignedPickList[]> {
  const lists = await replica.all<{
    id: string;
    status: string;
    createdAt: unknown;
  }>(
    `SELECT id, status, createdAt FROM PickList
     WHERE assignedUserId = ? AND status NOT IN (${FINISHED.map(() => '?').join(',')})
     ORDER BY createdAt, id`,
    [userId, ...FINISHED],
  );
  const lines = await replica.all<{
    id: string;
    pickListId: string;
    skuId: string;
    locationId: string;
    qtyRequested: number;
  }>(
    'SELECT id, pickListId, skuId, locationId, qtyRequested FROM PickLine ORDER BY id',
  );
  const synced = await replica.all<{ ref: string; total: number }>(
    "SELECT ref, SUM(qty) AS total FROM Movement WHERE type = 'PICK' AND ref IS NOT NULL GROUP BY ref",
  );
  const picked = new Map(synced.map((r) => [r.ref, Number(r.total)]));
  if (outbox) {
    const syncedIds = new Set(
      (
        await replica.all<{ id: string }>(
          "SELECT id FROM Movement WHERE type = 'PICK'",
        )
      ).map((r) => r.id),
    );
    for (const row of await listOutbox(outbox)) {
      if ('corrupt' in row) continue;
      const i = row.input;
      if (i.type !== 'PICK' || !i.ref || syncedIds.has(i.id)) continue;
      picked.set(i.ref, (picked.get(i.ref) ?? 0) + i.qty);
    }
  }
  return lists.map((l) => ({
    id: l.id,
    status: l.status,
    createdAt: parseDbDate(l.createdAt),
    lines: lines
      .filter((ln) => ln.pickListId === l.id)
      .map((ln) => ({
        id: ln.id,
        skuId: ln.skuId,
        locationId: ln.locationId,
        qtyRequested: Number(ln.qtyRequested),
        pickedQty: picked.get(ln.id) ?? 0,
      })),
  }));
}

export type AssignedCountTask = {
  id: string;
  scope: unknown;
  status: string;
};

/** Tasks assigned to the user or unassigned, not DONE/CLOSED. */
export async function assignedCountTasks(
  replica: Sql,
  userId: string,
): Promise<AssignedCountTask[]> {
  const rows = await replica.all<{ id: string; scope: string; status: string }>(
    `SELECT id, scope, status FROM CountTask
     WHERE (assignedUserId = ? OR assignedUserId IS NULL)
       AND status NOT IN (${FINISHED.map(() => '?').join(',')})
     ORDER BY id`,
    [userId, ...FINISHED],
  );
  return rows.map((r) => ({
    id: r.id,
    scope: safeJson(r.scope, {}),
    status: r.status,
  }));
}

export type MyException = {
  id: string;
  type: string;
  status: string;
  skuId: string | null;
  locationId: string | null;
  deviceId: string | null;
  details: unknown;
  movementIds: string[];
  createdAt: Date;
};

/** OPEN exceptions raised for this device, newest first. */
export async function myOpenExceptions(
  replica: Sql,
  deviceId: string,
): Promise<MyException[]> {
  const rows = await replica.all<{
    id: string;
    type: string;
    status: string;
    skuId: string | null;
    locationId: string | null;
    deviceId: string | null;
    details: string;
    movementIds: string;
    createdAt: unknown;
  }>(
    `SELECT id, type, status, skuId, locationId, deviceId, details, movementIds, createdAt
     FROM Exception WHERE status = 'OPEN' AND deviceId = ?
     ORDER BY createdAt DESC, id DESC`,
    [deviceId],
  );
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    status: r.status,
    skuId: r.skuId,
    locationId: r.locationId,
    deviceId: r.deviceId,
    details: safeJson(r.details, {}),
    movementIds: safeJson<string[]>(r.movementIds, []),
    createdAt: parseDbDate(r.createdAt),
  }));
}

function safeJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T;
  } catch {
    return fallback;
  }
}

export type InTransit = {
  movementId: string;
  fromWarehouseId: string;
  skuId: string;
  qty: number;
  ref: string | null;
  occurredAt: Date;
};

/**
 * TRANSFER_OUTs from every replica other than the destination's, addressed to
 * `warehouseId`, whose ref has no TRANSFER_IN in the destination replica nor
 * pending in `outbox` (rows with warehouseId = destination).
 */
export async function inTransitTo(
  replicas: Map<string, Sql>,
  warehouseId: string,
  outbox?: Sql,
): Promise<InTransit[]> {
  const dest = replicas.get(warehouseId);
  const received = new Set<string>();
  if (dest) {
    const ins = await dest.all<{ ref: string }>(
      "SELECT DISTINCT ref FROM Movement WHERE type = 'TRANSFER_IN' AND ref IS NOT NULL",
    );
    for (const r of ins) received.add(r.ref);
  }
  if (outbox) {
    for (const row of await listOutbox(outbox, { warehouseId })) {
      if ('corrupt' in row) continue;
      if (row.input.type === 'TRANSFER_IN') {
        received.add(row.input.transferId);
      }
    }
  }
  const out: InTransit[] = [];
  for (const [id, sql] of replicas) {
    if (id === warehouseId || id === 'catalog') continue;
    const rows = await sql.all<{
      id: string;
      skuId: string;
      qty: number;
      ref: string | null;
      occurredAt: unknown;
    }>(
      `SELECT id, skuId, qty, ref, occurredAt FROM Movement
       WHERE type = 'TRANSFER_OUT' AND counterpartWarehouseId = ?
       ORDER BY seq`,
      [warehouseId],
    );
    for (const r of rows) {
      if (r.ref !== null && received.has(r.ref)) continue;
      out.push({
        movementId: r.id,
        fromWarehouseId: id,
        skuId: r.skuId,
        qty: Number(r.qty),
        ref: r.ref,
        occurredAt: parseDbDate(r.occurredAt),
      });
    }
  }
  return out;
}

/** Reason codes whose `appliesTo` JSON array includes `movementType`, ordered by code. */
export async function reasonCodes(
  catalog: Sql,
  movementType: string,
): Promise<{ code: string; label: string }[]> {
  const rows = await catalog.all<{
    code: string;
    label: string;
    appliesTo: string;
  }>('SELECT code, label, appliesTo FROM ReasonCode ORDER BY code');
  return rows
    .filter((r) => {
      const applies = safeJson<unknown>(r.appliesTo, []);
      return Array.isArray(applies) && applies.includes(movementType);
    })
    .map((r) => ({ code: r.code, label: r.label }));
}
