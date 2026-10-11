import { describe, expect, it } from 'vitest';
import {
  detectClockSkew,
  detectOverPick,
  findStuckTransfers,
} from '#/domain/detectors';
import type { Movement } from '#/domain/types';

function mv(over: Partial<Movement>): Movement {
  return {
    id: 'm1',
    type: 'PICK',
    skuId: 'S1',
    fromLocationId: 'L1',
    toLocationId: null,
    qty: 1,
    reasonCode: null,
    ref: null,
    counterpartWarehouseId: null,
    userId: 'u1',
    deviceId: 'dev1',
    occurredAt: new Date('2026-10-11T10:00:00.000Z'),
    source: 'device',
    ...over,
  };
}

describe('detectOverPick', () => {
  const line = { id: 'line1', qtyRequested: 5 };

  it('raises when the pick crosses the requested qty', () => {
    const drafts = detectOverPick(mv({ qty: 2 }), line, 4);
    expect(drafts).toEqual([
      {
        type: 'OVER_PICK',
        movementIds: ['m1'],
        skuId: 'S1',
        locationId: 'L1',
        deviceId: 'dev1',
        details: { requested: 5, pickedAfter: 6 },
      },
    ]);
  });

  it('does not raise when already over before the pick', () => {
    expect(detectOverPick(mv({ qty: 1 }), line, 6)).toEqual([]);
  });

  it('does not raise when landing exactly on requested', () => {
    expect(detectOverPick(mv({ qty: 1 }), line, 4)).toEqual([]);
  });

  it('does not raise without a line', () => {
    expect(detectOverPick(mv({ qty: 9 }), null, 0)).toEqual([]);
  });
});

describe('findStuckTransfers', () => {
  const now = new Date('2026-10-12T12:00:00.000Z');
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const out = (h: number) =>
    mv({
      id: 'out1',
      type: 'TRANSFER_OUT',
      ref: 'T1',
      counterpartWarehouseId: 'W2',
      occurredAt: hoursAgo(h),
    });

  it('flags a 25h-old out with no matching in', () => {
    const drafts = findStuckTransfers([out(25)], new Set(), new Set(), now, 24);
    expect(drafts).toEqual([
      {
        type: 'TRANSFER_STUCK',
        movementIds: ['out1'],
        skuId: 'S1',
        locationId: 'L1',
        deviceId: 'dev1',
        details: {
          transferId: 'T1',
          counterpartWarehouseId: 'W2',
          ageHours: 25,
        },
      },
    ]);
  });

  it('skips outs with a matching in', () => {
    expect(
      findStuckTransfers([out(25)], new Set(['T1']), new Set(), now, 24),
    ).toEqual([]);
  });

  it('skips outs younger than the threshold', () => {
    expect(
      findStuckTransfers([out(23)], new Set(), new Set(), now, 24),
    ).toEqual([]);
  });

  it('uses a strict comparison at the threshold', () => {
    expect(
      findStuckTransfers([out(24)], new Set(), new Set(), now, 24),
    ).toEqual([]);
  });

  it('skips already flagged transfers', () => {
    expect(
      findStuckTransfers([out(25)], new Set(), new Set(['T1']), now, 24),
    ).toEqual([]);
  });
});

describe('detectClockSkew', () => {
  const serverNow = new Date('2026-10-11T10:00:00.000Z');
  const at = (ms: number) => new Date(serverNow.getTime() + ms);
  const threshold = 120_000;

  it('raises for a device clock ahead', () => {
    expect(
      detectClockSkew('dev1', at(180_000), serverNow, threshold, false),
    ).toEqual({
      type: 'CLOCK_SKEW',
      movementIds: [],
      skuId: null,
      locationId: null,
      deviceId: 'dev1',
      details: { skewMs: 180_000 },
    });
  });

  it('raises for a device clock behind', () => {
    const d = detectClockSkew(
      'dev1',
      at(-180_000),
      serverNow,
      threshold,
      false,
    );
    expect(d?.details).toEqual({ skewMs: -180_000 });
  });

  it('returns null within the threshold', () => {
    expect(
      detectClockSkew('dev1', at(60_000), serverNow, threshold, false),
    ).toBeNull();
  });

  it('returns null when one is already open', () => {
    expect(
      detectClockSkew('dev1', at(180_000), serverNow, threshold, true),
    ).toBeNull();
  });
});
