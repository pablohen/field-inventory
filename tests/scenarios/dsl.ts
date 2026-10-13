import { randomUUID } from 'node:crypto';
import { expect } from 'vitest';
import { balanceKeyString } from '#/domain/balance';
import { type MovementInput, toMovement } from '#/domain/schemas';
import type { ExceptionType, Movement } from '#/domain/types';
import { SCHEMA_VERSIONS } from '#/server/db/migrate';
import { type SyncDeps, syncMovementsCore } from '#/server/sync/sync-movements';
import { simulate } from '../support/simulate';
import { createTestEnv } from '../support/test-env';

/** Fixed server clock for every scenario. Action times ('HH:MM') are this day, UTC. */
export const NOW = new Date('2026-01-01T12:00:00Z');
const SETUP_DEVICE = 'setup';

type Distribute<T> = T extends MovementInput
  ? Omit<T, 'id' | 'deviceId' | 'occurredAt' | 'userId' | 'transferId'> & {
      transferId?: string;
    }
  : never;
type ActionInput = Distribute<MovementInput>;

export interface Scenario {
  name: string;
  setup: {
    warehouses: string[];
    products: { id: string; tolerance: number }[];
    locations: Record<string, string[]>;
    devices: { id: string; warehouses: string[]; skewMs?: number }[];
    initial: {
      warehouse: string;
      skuId: string;
      locationId: string;
      qty: number;
    }[];
  };
  actions: { device: string; at: string; input: ActionInput }[];
  /** Each entry is one sync round: the devices that sync, in order. */
  syncOrder: string[][];
  expect: {
    /** Absolute final balances, keyed 'warehouse|sku|location'; missing keys must be 0. */
    balances: Record<string, number>;
    /** Multiset of exceptions; a missing key matches on type alone. */
    exceptions: { type: ExceptionType; key?: string }[];
  };
}

function exceptionLabel(type: string, key?: string): string {
  return key === undefined ? type : `${type}@${key}`;
}

export async function runScenario(s: Scenario): Promise<void> {
  const env = await createTestEnv();
  try {
    const wh = s.setup.warehouses;
    await env.seedDevice({ id: SETUP_DEVICE, warehouses: wh });
    await env.seedUser({
      id: `user-${SETUP_DEVICE}`,
      username: `user-${SETUP_DEVICE}`,
      pin: '1234',
    });
    for (const d of s.setup.devices) {
      await env.seedDevice({ id: d.id, warehouses: d.warehouses });
      await env.seedUser({
        id: `user-${d.id}`,
        username: `user-${d.id}`,
        pin: '1234',
      });
    }
    for (const p of s.setup.products) {
      await env.seedProduct({
        id: p.id,
        sku: p.id,
        countTolerance: p.tolerance,
      });
    }
    for (const [w, locs] of Object.entries(s.setup.locations)) {
      for (const id of locs) await env.seedLocation(w, { id, code: id });
    }

    const dbs = new Map(
      await Promise.all(
        wh.map(async (w) => [w, await env.warehouse(w)] as const),
      ),
    );
    const deps: SyncDeps = {
      global: env.global,
      catalog: env.catalog,
      warehouseDb: (name) => {
        const db = dbs.get(name);
        if (!db) throw new Error(`no db ${name}`);
        return db;
      },
      now: () => NOW,
      newId: randomUUID,
      clockSkewThresholdMs: 120_000,
      transferStuckHours: 24,
    };

    const atTime = (hhmm: string, skewMs: number) =>
      new Date(Date.parse(`2026-01-01T${hhmm}:00Z`) + skewMs);
    // Order the server processes rows within one batch: (occurredAt, id).
    const serverOrder = (rows: MovementInput[]) =>
      [...rows].sort(
        (a, b) =>
          a.occurredAt.getTime() - b.occurredAt.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
    const processed: Movement[] = [];

    async function send(
      deviceId: string,
      skewMs: number,
      rows: MovementInput[],
    ) {
      const res = await syncMovementsCore(deps, {
        deviceId,
        schemaVersion: SCHEMA_VERSIONS.warehouse,
        sentAt: new Date(NOW.getTime() + skewMs).toISOString(),
        movements: rows,
      });
      expect(res.status).toBe('ok');
      if (res.status !== 'ok') return;
      for (const r of res.results) expect(r.status).toBe('accepted');
      for (const r of serverOrder(rows)) {
        processed.push(toMovement(r, 'device'));
      }
    }

    // Initial balances: ADJUST/INITIAL at 00:00 from the setup device.
    const initialRows: MovementInput[] = s.setup.initial.map((i) => ({
      id: randomUUID(),
      type: 'ADJUST',
      warehouseId: i.warehouse,
      skuId: i.skuId,
      userId: `user-${SETUP_DEVICE}`,
      deviceId: SETUP_DEVICE,
      occurredAt: atTime('00:00', 0),
      locationId: i.locationId,
      qty: i.qty,
      reasonCode: 'INITIAL',
    }));
    for (const w of wh) {
      const rows = initialRows.filter((r) => r.warehouseId === w);
      if (rows.length > 0) await send(SETUP_DEVICE, 0, rows);
    }

    // Outboxes: one per device, with ids, user and skewed occurredAt filled in.
    const transferIds = new Map<string, string>();
    const outbox = new Map<string, MovementInput[]>();
    const skewOf = new Map(s.setup.devices.map((d) => [d.id, d.skewMs ?? 0]));
    for (const a of s.actions) {
      const { transferId, ...rest } = a.input;
      const base = {
        ...rest,
        id: randomUUID(),
        deviceId: a.device,
        userId: `user-${a.device}`,
        occurredAt: atTime(a.at, skewOf.get(a.device) ?? 0),
      };
      let row: MovementInput;
      if (base.type === 'TRANSFER_OUT' || base.type === 'TRANSFER_IN') {
        // OUT and IN of one scenario share a transfer id unless pinned.
        let tid = transferId ?? transferIds.get('default');
        if (tid === undefined) tid = randomUUID();
        transferIds.set('default', tid);
        row = { ...base, transferId: tid } as MovementInput;
      } else {
        row = base as MovementInput;
      }
      outbox.set(a.device, [...(outbox.get(a.device) ?? []), row]);
    }

    for (const round of s.syncOrder) {
      for (const deviceId of round) {
        const rows = outbox.get(deviceId) ?? [];
        outbox.delete(deviceId);
        if (rows.length > 0)
          await send(deviceId, skewOf.get(deviceId) ?? 0, rows);
      }
    }
    expect([...outbox.keys()], 'devices never synced').toEqual([]);

    // Balances from the database, 'warehouse|sku|location'.
    const actual = new Map<string, number>();
    const exceptions: string[] = [];
    for (const [w, db] of dbs) {
      for (const b of await db.stockBalance.findMany()) {
        actual.set(`${w}|${b.skuId}|${b.locationId}`, b.qty);
      }
      for (const e of await db.exception.findMany({
        where: { status: 'OPEN' },
      })) {
        exceptions.push(
          exceptionLabel(
            e.type,
            e.skuId !== null && e.locationId !== null
              ? `${w}|${e.skuId}|${e.locationId}`
              : undefined,
          ),
        );
      }
    }

    const keys = new Set([...actual.keys(), ...Object.keys(s.expect.balances)]);
    const got = Object.fromEntries(
      [...keys].sort().map((k) => [k, actual.get(k) ?? 0]),
    );
    const want = Object.fromEntries(
      [...keys].sort().map((k) => [k, s.expect.balances[k] ?? 0]),
    );
    expect(got).toEqual(want);

    // Expected entries without a key match on type alone.
    const remaining = [...exceptions];
    const unmatched: string[] = [];
    for (const e of s.expect.exceptions) {
      const i = remaining.findIndex((r) =>
        e.key === undefined
          ? r === e.type || r.startsWith(`${e.type}@`)
          : r === exceptionLabel(e.type, e.key),
      );
      if (i === -1) unmatched.push(exceptionLabel(e.type, e.key));
      else remaining.splice(i, 1);
    }
    expect({ unmatched, unexpected: remaining }).toEqual({
      unmatched: [],
      unexpected: [],
    });

    // Pure path and database path must agree (single-warehouse scenarios).
    if (wh.length === 1) {
      const toleranceOf = new Map(
        s.setup.products.map((p) => [p.id, p.tolerance]),
      );
      const sim = simulate(processed, (sku) => toleranceOf.get(sku) ?? 0);
      const simulated = Object.fromEntries(
        [...keys].sort().map((k) => {
          const [, sku = '', loc = ''] = k.split('|');
          return [
            k,
            sim.balances.get(
              balanceKeyString({ skuId: sku, locationId: loc }),
            ) ?? 0,
          ];
        }),
      );
      expect(simulated).toEqual(got);
    }
  } finally {
    await env.cleanup();
  }
}
