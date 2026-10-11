import { describe, expect, it } from 'vitest';
import {
  type MovementInput,
  movementInputSchema,
  syncBatchSchema,
  toMovement,
} from '#/domain/schemas';

const U1 = '11111111-1111-4111-8111-111111111111';
const U2 = '22222222-2222-4222-8222-222222222222';

const common = {
  id: U1,
  warehouseId: 'WH1',
  skuId: 'SKU1',
  userId: 'user1',
  deviceId: 'dev1',
  occurredAt: '2026-10-11T10:00:00.000Z',
};

const fixtures: Record<string, Record<string, unknown>> = {
  PICK: { ...common, type: 'PICK', fromLocationId: 'A1', qty: 2, ref: 'line1' },
  MOVE: {
    ...common,
    type: 'MOVE',
    fromLocationId: 'A1',
    toLocationId: 'B1',
    qty: 3,
  },
  COUNT: { ...common, type: 'COUNT', locationId: 'A1', qty: 0, ref: 'task1' },
  ADJUST: {
    ...common,
    type: 'ADJUST',
    locationId: 'A1',
    qty: -4,
    reasonCode: 'DAMAGE',
  },
  TRANSFER_OUT: {
    ...common,
    type: 'TRANSFER_OUT',
    fromLocationId: 'A1',
    qty: 5,
    transferId: U2,
    counterpartWarehouseId: 'WH2',
  },
  TRANSFER_IN: {
    ...common,
    type: 'TRANSFER_IN',
    toLocationId: 'A1',
    qty: 5,
    transferId: U2,
    counterpartWarehouseId: 'WH2',
  },
};

describe('movementInputSchema', () => {
  it.each(Object.entries(fixtures))('accepts a valid %s', (_type, fixture) => {
    expect(movementInputSchema.safeParse(fixture).success).toBe(true);
  });

  it('rejects MOVE with from === to', () => {
    expect(
      movementInputSchema.safeParse({ ...fixtures.MOVE, toLocationId: 'A1' })
        .success,
    ).toBe(false);
  });

  it('rejects PICK qty 0', () => {
    expect(
      movementInputSchema.safeParse({ ...fixtures.PICK, qty: 0 }).success,
    ).toBe(false);
  });

  it('rejects non-integer qty', () => {
    expect(
      movementInputSchema.safeParse({ ...fixtures.PICK, qty: 1.5 }).success,
    ).toBe(false);
  });

  it('rejects ADJUST qty 0', () => {
    expect(
      movementInputSchema.safeParse({ ...fixtures.ADJUST, qty: 0 }).success,
    ).toBe(false);
  });

  it('rejects COUNT qty -1', () => {
    expect(
      movementInputSchema.safeParse({ ...fixtures.COUNT, qty: -1 }).success,
    ).toBe(false);
  });

  it('rejects a non-UUID id', () => {
    expect(
      movementInputSchema.safeParse({ ...fixtures.PICK, id: 'nope' }).success,
    ).toBe(false);
  });

  it('rejects an unknown type', () => {
    expect(
      movementInputSchema.safeParse({ ...fixtures.PICK, type: 'TELEPORT' })
        .success,
    ).toBe(false);
  });

  it('rejects an empty warehouseId', () => {
    expect(
      movementInputSchema.safeParse({ ...fixtures.PICK, warehouseId: '' })
        .success,
    ).toBe(false);
  });
});

describe('toMovement', () => {
  const parse = (type: string): MovementInput =>
    movementInputSchema.parse(fixtures[type]);

  it('maps COUNT locationId to toLocationId', () => {
    const input = parse('COUNT');
    const m = toMovement(input, 'device');
    expect(input.type === 'COUNT' && m.toLocationId === input.locationId).toBe(
      true,
    );
    expect(m.fromLocationId).toBeNull();
    expect(m.source).toBe('device');
    expect(m.counterpartWarehouseId).toBeNull();
    expect(m.occurredAt).toBeInstanceOf(Date);
    expect('warehouseId' in m).toBe(false);
  });

  it('maps TRANSFER_OUT transferId to ref and keeps counterpart', () => {
    const m = toMovement(parse('TRANSFER_OUT'), 'device');
    expect(m.ref).toBe(U2);
    expect(m.fromLocationId).toBe('A1');
    expect(m.toLocationId).toBeNull();
    expect(m.counterpartWarehouseId).toBe('WH2');
  });

  it('maps MOVE to both locations and PICK ref/reasonCode defaults', () => {
    const move = toMovement(parse('MOVE'), 'supervisor');
    expect([move.fromLocationId, move.toLocationId]).toEqual(['A1', 'B1']);
    const pick = toMovement(
      movementInputSchema.parse({ ...fixtures.PICK, ref: undefined }),
      'system',
    );
    expect(pick.ref).toBeNull();
    expect(pick.reasonCode).toBeNull();
  });

  it('carries ADJUST reasonCode', () => {
    const m = toMovement(parse('ADJUST'), 'supervisor');
    expect(m.reasonCode).toBe('DAMAGE');
    expect(m.toLocationId).toBe('A1');
  });
});

describe('date strictness', () => {
  const parseWith = (occurredAt: unknown) =>
    movementInputSchema.safeParse({ ...fixtures.PICK, occurredAt });

  it.each([
    ['null', null],
    ['0', 0],
    ['false', false],
    ['seconds number', 1760000000],
    ['garbage string', 'not a date'],
  ])('rejects %s for occurredAt', (_n, v) => {
    expect(parseWith(v).success).toBe(false);
  });

  it('accepts an ISO string with Z or an offset, and a Date', () => {
    for (const v of [
      '2026-10-11T10:00:00Z',
      '2026-10-11T10:00:00+02:00',
      new Date('2026-10-11T10:00:00Z'),
    ]) {
      const r = parseWith(v);
      expect(r.success).toBe(true);
      if (r.success) expect(r.data.occurredAt).toBeInstanceOf(Date);
    }
  });

  it('rejects null and 0 for sentAt', () => {
    for (const v of [null, 0]) {
      expect(
        syncBatchSchema.safeParse({
          deviceId: 'd',
          schemaVersion: 1,
          sentAt: v,
          movements: [],
        }).success,
      ).toBe(false);
    }
  });
});

describe('syncBatchSchema', () => {
  const batch = {
    deviceId: 'd',
    schemaVersion: 1,
    sentAt: '2026-10-11T10:00:00Z',
    movements: [{}, 1],
  };
  it('keeps rows unknown and coerces sentAt', () => {
    const r = syncBatchSchema.parse(batch);
    expect(r.sentAt).toBeInstanceOf(Date);
    expect(r.movements).toHaveLength(2);
  });
  it('rejects more than 500 rows', () => {
    expect(
      syncBatchSchema.safeParse({ ...batch, movements: new Array(501).fill(0) })
        .success,
    ).toBe(false);
  });
});
