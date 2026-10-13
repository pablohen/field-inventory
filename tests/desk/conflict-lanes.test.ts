import { describe, expect, it } from 'vitest';
import {
  CHAR_W,
  LANE_W,
  type LaneInput,
  laneLayout,
  laneSlot,
} from '#/desk/conflict-lanes';

function m(
  id: string,
  occurredAt: string,
  seq: number,
  delta: number | null,
): LaneInput {
  return { id, occurredAt, seq, type: 'MOVE', delta, worker: 'Wendy' };
}

describe('laneLayout', () => {
  it('flags the movement that arrived after a later-happening one', () => {
    const out = laneLayout([
      m('move', '2026-03-01T10:00:00.000Z', 19, -3),
      { ...m('count', '2026-03-01T10:30:00.000Z', 17, 5), type: 'COUNT' },
    ]);
    const move = out.find((o) => o.id === 'move');
    const count = out.find((o) => o.id === 'count');
    expect(move).toMatchObject({ happenedRank: 0, arrivedRank: 1, late: true });
    expect(count).toMatchObject({
      happenedRank: 1,
      arrivedRank: 0,
      late: false,
    });
    expect(move?.label).toBe('MOVE −3 · Wendy');
  });

  it('flags nothing when orders agree', () => {
    const out = laneLayout([
      m('a', '2026-03-01T10:00:00.000Z', 1, 1),
      m('b', '2026-03-01T11:00:00.000Z', 2, 1),
    ]);
    expect(out.every((o) => !o.late)).toBe(true);
  });

  it('breaks occurredAt ties by seq', () => {
    const t = '2026-03-01T10:00:00.000Z';
    const out = laneLayout([m('b', t, 2, 1), m('a', t, 1, 1)]);
    expect(out.find((o) => o.id === 'a')?.happenedRank).toBe(0);
    expect(out.every((o) => !o.late)).toBe(true);
  });

  it('handles one movement and none; null delta omits the amount', () => {
    const one = laneLayout([m('a', '2026-03-01T10:00:00.000Z', 1, null)]);
    expect(one).toHaveLength(1);
    expect(one[0]?.late).toBe(false);
    expect(one[0]?.label).toBe('MOVE · Wendy');
    expect(laneLayout([])).toEqual([]);
  });

  it('flags only the overtaken one among three, with a short label', () => {
    const out = laneLayout([
      m('C', '2026-03-01T09:00:00.000Z', 3, -6),
      m('A', '2026-03-01T10:00:00.000Z', 1, 2),
      m('B', '2026-03-01T11:00:00.000Z', 2, 2),
    ]);
    expect(out.filter((o) => o.late).map((o) => o.id)).toEqual(['C']);
    expect(out.find((o) => o.id === 'C')?.shortLabel).toBe('MOVE −6');
    expect(out.find((o) => o.id === 'C')?.label).toBe('MOVE −6 · Wendy');
  });
});

describe('laneSlot', () => {
  it('keeps same-row labels apart and inside the viewBox at n=12', () => {
    const n = 12;
    const width = 'TRANSFER_OUT −99'.length * CHAR_W;
    const slots = Array.from({ length: n }, (_, r) => laneSlot(r, n));
    for (let i = 0; i < n; i++) {
      const a = slots[i];
      if (!a) continue;
      expect(a.labelX - width / 2).toBeGreaterThanOrEqual(0);
      expect(a.labelX + width / 2).toBeLessThanOrEqual(LANE_W);
      for (let j = i + 1; j < n; j++) {
        const b = slots[j];
        if (b && a.row === b.row) {
          expect(Math.abs(b.x - a.x)).toBeGreaterThanOrEqual(width * 1.2);
        }
      }
    }
  });

  it('centres a single point', () => {
    expect(laneSlot(0, 1).x).toBe(LANE_W / 2);
  });
});
