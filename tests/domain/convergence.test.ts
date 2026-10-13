import fc from 'fast-check';
import { describe, it } from 'vitest';
import { balanceKeyString, movementDeltas } from '#/domain/balance';
import type { Movement } from '#/domain/types';
import { simulate } from '../support/simulate';

const HOUR_START = Date.UTC(2026, 0, 1, 10, 0, 0);

interface Scenario {
  movements: Movement[];
  permutation: Movement[];
}

function movementArb(
  index: number,
  skus: string[],
  locs: string[],
): fc.Arbitrary<Movement> {
  const base = fc.record({
    sku: fc.constantFrom(...skus),
    loc: fc.constantFrom(...locs),
    loc2: fc.constantFrom(...locs),
    qty: fc.integer({ min: 1, max: 20 }),
    sign: fc.constantFrom(1, -1),
    minute: fc.integer({ min: 0, max: 59 }),
    reason: fc.constantFrom('DAMAGE', 'FOUND', 'OTHER'),
  });
  return fc
    .tuple(base, fc.constantFrom('PICK', 'MOVE', 'ADJUST', 'COUNT'))
    .filter(([b, type]) => type !== 'MOVE' || b.loc !== b.loc2)
    .map(([b, type]): Movement => {
      const m: Movement = {
        id: `m-${index}`,
        type,
        skuId: b.sku,
        fromLocationId: null,
        toLocationId: null,
        qty: b.qty,
        reasonCode: null,
        ref: null,
        counterpartWarehouseId: null,
        userId: 'u1',
        deviceId: 'd1',
        occurredAt: new Date(HOUR_START + b.minute * 60_000),
        source: 'device',
      };
      switch (type) {
        case 'PICK':
          m.fromLocationId = b.loc;
          break;
        case 'MOVE':
          m.fromLocationId = b.loc;
          m.toLocationId = b.loc2;
          break;
        case 'ADJUST':
          m.toLocationId = b.loc;
          m.qty = b.qty * b.sign;
          m.reasonCode = b.reason;
          break;
        case 'COUNT':
          m.toLocationId = b.loc;
          m.qty = b.qty - 1; // >= 0
          break;
      }
      return m;
    });
}

function scenarioArb(types: Movement['type'][]): fc.Arbitrary<Scenario> {
  return fc
    .tuple(
      fc.integer({ min: 1, max: 3 }),
      fc.integer({ min: 1, max: 3 }),
      fc.integer({ min: 1, max: 25 }),
    )
    .chain(([nSkus, nLocs, n]) => {
      const skus = Array.from({ length: nSkus }, (_, i) => `sku-${i}`);
      const locs = Array.from({ length: nLocs }, (_, i) => `loc-${i}`);
      return fc
        .tuple(
          ...Array.from({ length: n }, (_, i) => movementArb(i, skus, locs)),
        )
        .map((ms) => ms.filter((m) => types.includes(m.type)))
        .chain((movements) =>
          fc
            .shuffledSubarray(movements, {
              minLength: movements.length,
              maxLength: movements.length,
            })
            .map((permutation) => ({ movements, permutation })),
        );
    });
}

function keysOf(m: Movement): string[] {
  const keys = new Set(movementDeltas(m).map(balanceKeyString));
  if (m.type === 'COUNT' && m.toLocationId !== null) {
    keys.add(balanceKeyString({ skuId: m.skuId, locationId: m.toLocationId }));
  }
  return [...keys];
}

function sameBalances(a: Map<string, number>, b: Map<string, number>): boolean {
  for (const k of new Set([...a.keys(), ...b.keys()])) {
    if ((a.get(k) ?? 0) !== (b.get(k) ?? 0)) return false;
  }
  return true;
}

const NO_COUNT: Movement['type'][] = ['PICK', 'MOVE', 'ADJUST'];
const ALL: Movement['type'][] = ['PICK', 'MOVE', 'ADJUST', 'COUNT'];
const RUNS = { numRuns: 200 };

describe('convergence', () => {
  it('(a) without COUNTs, balances are independent of arrival order', () => {
    fc.assert(
      fc.property(scenarioArb(NO_COUNT), ({ movements, permutation }) => {
        const x = simulate(movements, () => 0).balances;
        const y = simulate(permutation, () => 0).balances;
        return sameBalances(x, y);
      }),
      RUNS,
    );
  });

  it('(b) with COUNTs and infinite tolerance, balances are independent of arrival order', () => {
    fc.assert(
      fc.property(scenarioArb(ALL), ({ movements, permutation }) => {
        const x = simulate(movements, () => Infinity).balances;
        const y = simulate(permutation, () => Infinity).balances;
        return sameBalances(x, y);
      }),
      RUNS,
    );
  });

  it('(c) with tolerance 0, every key diverging from the auto-adjusted result has a variance or late-movement exception', () => {
    fc.assert(
      fc.property(scenarioArb(ALL), ({ permutation }) => {
        const strict = simulate(permutation, () => 0);
        const lenient = simulate(permutation, () => Infinity).balances;
        const flagged = new Set(
          strict.exceptions
            .filter(
              (e) => e.type === 'COUNT_VARIANCE' || e.type === 'LATE_MOVEMENT',
            )
            .filter((e) => e.skuId !== null && e.locationId !== null)
            .map((e) =>
              balanceKeyString({
                skuId: e.skuId as string,
                locationId: e.locationId as string,
              }),
            ),
        );
        for (const k of new Set([
          ...strict.balances.keys(),
          ...lenient.keys(),
        ])) {
          if ((strict.balances.get(k) ?? 0) !== (lenient.get(k) ?? 0)) {
            if (!flagged.has(k)) return false;
          }
        }
        return true;
      }),
      RUNS,
    );
  });

  it('(b2) with infinite tolerance, a counted bin ends at the latest count plus later movements', () => {
    fc.assert(
      fc.property(scenarioArb(ALL), ({ permutation }) => {
        const { balances } = simulate(permutation, () => Infinity);
        const keys = new Set(permutation.flatMap((m) => keysOf(m)));
        for (const key of keys) {
          const counts = permutation
            .filter((m) => m.type === 'COUNT' && keysOf(m)[0] === key)
            .sort(
              (a, b) =>
                a.occurredAt.getTime() - b.occurredAt.getTime() ||
                (a.id < b.id ? -1 : 1),
            );
          const last = counts.at(-1);
          if (last === undefined) continue;
          let expected = last.qty;
          for (const m of permutation) {
            if (m.type === 'COUNT') continue;
            if (m.occurredAt.getTime() <= last.occurredAt.getTime()) continue;
            for (const d of movementDeltas(m)) {
              if (balanceKeyString(d) === key) expected += d.delta;
            }
          }
          if ((balances.get(key) ?? 0) !== expected) return false;
        }
        return true;
      }),
      RUNS,
    );
  });

  it('(d) open count exceptions: at most one per count, and the same counts flagged in every order when each bin has at most one count', () => {
    // Open CV/LM draft count ids; null when a count has more than one.
    const flaggedCounts = (
      order: Movement[],
      tolerance: number,
    ): Set<string> | null => {
      const seen = new Set<string>();
      for (const e of simulate(order, () => tolerance).exceptions) {
        if (e.type !== 'COUNT_VARIANCE' && e.type !== 'LATE_MOVEMENT') continue;
        const id = e.movementIds[0];
        if (id === undefined || seen.has(id)) return null;
        seen.add(id);
      }
      return seen;
    };
    // Keep only the first COUNT per bin (same ids dropped from both orders).
    const onePerBin = (movements: Movement[], permutation: Movement[]) => {
      const keep = new Set<string>();
      const bins = new Set<string>();
      for (const m of movements) {
        if (m.type !== 'COUNT') keep.add(m.id);
        else {
          const k = keysOf(m)[0] ?? '';
          if (!bins.has(k)) {
            bins.add(k);
            keep.add(m.id);
          }
        }
      }
      return [
        movements.filter((m) => keep.has(m.id)),
        permutation.filter((m) => keep.has(m.id)),
      ] as const;
    };
    fc.assert(
      fc.property(
        scenarioArb(ALL),
        fc.integer({ min: 0, max: 6 }),
        ({ movements, permutation }, tolerance) => {
          if (
            flaggedCounts(movements, tolerance) === null ||
            flaggedCounts(permutation, tolerance) === null
          )
            return false;
          const [a, b] = onePerBin(movements, permutation);
          const x = flaggedCounts(a, tolerance);
          const y = flaggedCounts(b, tolerance);
          if (x === null || y === null) return false;
          return x.size === y.size && [...x].every((id) => y.has(id));
        },
      ),
      RUNS,
    );
  });
});
