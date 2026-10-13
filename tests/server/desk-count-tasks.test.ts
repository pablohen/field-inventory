import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SessionClaims } from '#/server/auth/session';
import {
  assignCountTaskCore,
  type CountTaskDeps,
  closeCountTaskCore,
  countScopeSchema,
  createCountTaskCore,
  createCountTaskInputSchema,
  handleAssignCountTask,
  handleCloseCountTask,
  handleCreateCountTask,
  handleListCountTasks,
  listCountTasksCore,
} from '#/server/desk/count-tasks.server';
import { handleListWorkers, listWorkersCore } from '#/server/desk/users.server';
import { createTestEnv, type TestEnv } from '../support/test-env';

const WH = 'wh1';

describe('count tasks', () => {
  let env: TestEnv;
  let deps: CountTaskDeps;
  let counter = 0;
  const uuid = () =>
    `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

  beforeEach(async () => {
    counter = 0;
    env = await createTestEnv();
    await env.seedDevice({ id: 'dev1', warehouses: [WH] });
    await env.seedUser({ id: 'w1', username: 'w1', pin: '1234' });
    await env.seedUser({
      id: 'sup',
      username: 'sup',
      pin: '1234',
      role: 'supervisor',
    });
    await env.seedProduct({ id: 'P1', sku: 'SKU-1' });
    for (const n of [1, 2, 3]) {
      await env.seedLocation(WH, { id: `A${n}`, code: `A-0${n}` });
    }
    const db = await env.warehouse(WH);
    await db.location.updateMany({
      where: { id: { in: ['A1', 'A2', 'A3'] } },
      data: { zone: 'A' },
    });
    deps = {
      global: env.global,
      catalog: env.catalog,
      warehouseDb: () => db,
      newId: uuid,
    };
  });
  afterEach(() => env.cleanup());

  async function create(scope: object, assignedUserId?: string) {
    const r = await createCountTaskCore(deps, WH, {
      scope: scope as never,
      assignedUserId,
    });
    if (!r.ok) throw new Error(r.message);
    return r.id;
  }
  async function tasks(status?: 'OPEN' | 'DONE') {
    const r = await listCountTasksCore(deps, WH, { status });
    if (!r.ok) throw new Error(r.message);
    return r.tasks;
  }

  it('validates the scope shape', () => {
    expect(countScopeSchema.safeParse({ zone: 'A' }).success).toBe(true);
    expect(countScopeSchema.safeParse({ locations: [] }).success).toBe(false);
    expect(countScopeSchema.safeParse({ skus: ['P1'] }).success).toBe(true);
    expect(countScopeSchema.safeParse({}).success).toBe(false);
  });

  it('creates by zone, by locations and by skus', async () => {
    const z = await create({ zone: 'A' }, 'w1');
    await create({ locations: ['A1', 'A2'] });
    await create({ skus: ['P1'] });
    const all = await tasks();
    expect(all).toHaveLength(3);
    expect(all.find((t) => t.id === z)).toMatchObject({
      status: 'OPEN',
      scope: { zone: 'A' },
      assignedUserId: 'w1',
      assignedUserName: 'w1',
      countsRecorded: 0,
    });
  });

  it('rejects an empty zone, unknown location, unknown SKU, bad assignee', async () => {
    const bad = async (scope: object, assignedUserId?: string) =>
      createCountTaskCore(deps, WH, { scope: scope as never, assignedUserId });
    for (const r of [
      await bad({ zone: 'Z' }),
      await bad({ locations: ['A1', 'NOPE'] }),
      await bad({ skus: ['NOPE'] }),
      await bad({ zone: 'A' }, 'sup'),
      await bad({ zone: 'A' }, 'ghost'),
    ]) {
      expect(r).toMatchObject({ ok: false, code: 'INVALID' });
    }
    expect(await tasks()).toHaveLength(0);
  });

  it('counts COUNT movements whose ref is the task id', async () => {
    const id = await create({ zone: 'A' });
    const other = await create({ zone: 'A' });
    const db = await env.warehouse(WH);
    const mv = (n: number, type: string, ref: string) =>
      db.movement.create({
        data: {
          id: `m${n}`,
          type,
          skuId: 'P1',
          toLocationId: 'A1',
          qty: 1,
          ref,
          userId: 'w1',
          deviceId: 'dev1',
          occurredAt: new Date('2026-03-01T12:00:00Z'),
          source: 'device',
        },
      });
    await mv(1, 'COUNT', id);
    await mv(2, 'COUNT', id);
    await mv(3, 'ADJUST', id);
    await mv(4, 'COUNT', other);
    const all = await tasks();
    expect(all.find((t) => t.id === id)?.countsRecorded).toBe(2);
    expect(all.find((t) => t.id === other)?.countsRecorded).toBe(1);
  });

  it('orders OPEN before DONE, then by id, and filters by status', async () => {
    const db = await env.warehouse(WH);
    for (const [id, status] of [
      ['t-c', 'OPEN'],
      ['t-a', 'DONE'],
      ['t-d', 'OPEN'],
      ['t-b', 'DONE'],
    ] as const) {
      await db.countTask.create({
        data: { id, scope: '{"zone":"A"}', status },
      });
    }
    expect((await tasks()).map((t) => t.id)).toEqual([
      't-c',
      't-d',
      't-a',
      't-b',
    ]);
    expect((await tasks('OPEN')).map((t) => t.id)).toEqual(['t-c', 't-d']);
    expect((await tasks('DONE')).map((t) => t.id)).toEqual(['t-a', 't-b']);
  });

  it('allows inactive locations and all-inactive zones', async () => {
    const db = await env.warehouse(WH);
    await env.seedLocation(WH, { id: 'X1', code: 'X-01', active: false });
    await db.location.update({ where: { id: 'X1' }, data: { zone: 'X' } });
    await create({ locations: ['X1'] });
    await create({ zone: 'X' });
    expect(await tasks()).toHaveLength(2);
  });

  it('rejects mixed locations+skus scope instead of stripping', async () => {
    const mixed = { locations: ['A1'], skus: ['P1'] };
    expect(countScopeSchema.safeParse(mixed).success).toBe(false);
    expect(createCountTaskInputSchema.safeParse({ scope: mixed }).success).toBe(
      false,
    );
  });

  it('lists a malformed stored scope as null with malformed: true', async () => {
    const db = await env.warehouse(WH);
    await db.countTask.create({
      data: { id: 'bad', scope: '{oops', status: 'OPEN' },
    });
    const [t] = await tasks();
    expect(t).toMatchObject({ id: 'bad', scope: null, malformed: true });
  });

  it('closes a task, idempotently; unknown ids are NOT_FOUND', async () => {
    const id = await create({ zone: 'A' });
    expect(await closeCountTaskCore(deps, WH, id)).toEqual({ ok: true });
    expect(await closeCountTaskCore(deps, WH, id)).toEqual({ ok: true });
    expect((await tasks())[0]?.status).toBe('DONE');
    expect(await closeCountTaskCore(deps, WH, 'nope')).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(await assignCountTaskCore(deps, WH, 'nope', null)).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('assigns, unassigns, validates the assignee, and rejects closed tasks', async () => {
    const id = await create({ zone: 'A' });
    expect(await assignCountTaskCore(deps, WH, id, 'w1')).toEqual({ ok: true });
    expect((await tasks())[0]?.assignedUserId).toBe('w1');
    expect(await assignCountTaskCore(deps, WH, id, 'sup')).toMatchObject({
      ok: false,
      code: 'INVALID',
    });
    expect(await assignCountTaskCore(deps, WH, id, null)).toEqual({ ok: true });
    expect((await tasks())[0]?.assignedUserId).toBeNull();
    await closeCountTaskCore(deps, WH, id);
    expect(await assignCountTaskCore(deps, WH, id, 'w1')).toMatchObject({
      ok: false,
      code: 'INVALID',
      message: 'Count task is closed',
    });
  });

  it('listWorkersCore returns only workers, ordered by name', async () => {
    await env.seedUser({ id: 'w0', username: 'aaron', pin: '1234' });
    await env.seedUser({
      id: 'adm',
      username: 'adm',
      pin: '1234',
      role: 'admin',
    });
    const ws = await listWorkersCore(env.global);
    expect(ws).toEqual([
      { id: 'w0', name: 'aaron' },
      { id: 'w1', name: 'w1' },
    ]);
  });

  it('listWorkersCore excludes disabled workers', async () => {
    await env.seedUser({
      id: 'off',
      username: 'aaa-off',
      pin: '1234',
      disabledAt: new Date(),
    });
    const ws = await listWorkersCore(env.global);
    expect(ws.map((w) => w.id)).not.toContain('off');
  });

  it('returns 403 for a worker session on every handler', async () => {
    const worker = {
      userId: 'w1',
      deviceId: 'dev1',
      role: 'worker',
      exp: 0,
    } as SessionClaims;
    const calls = [
      () =>
        handleCreateCountTask(
          worker,
          { warehouseId: WH, scope: { zone: 'A' } },
          deps,
        ),
      () => handleListCountTasks(worker, { warehouseId: WH }, deps),
      () =>
        handleAssignCountTask(
          worker,
          { warehouseId: WH, taskId: 'x', assignedUserId: null },
          deps,
        ),
      () =>
        handleCloseCountTask(worker, { warehouseId: WH, taskId: 'x' }, deps),
      () => handleListWorkers(worker, { global: env.global }),
    ];
    for (const call of calls) {
      const err = await call().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(Response);
      expect((err as Response).status).toBe(403);
    }
    expect(await tasks()).toHaveLength(0);
  });
});
