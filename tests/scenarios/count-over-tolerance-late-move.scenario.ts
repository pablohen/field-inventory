import type { Scenario } from './dsl';

// Tolerance 0. L1 starts at 10. A moves 6 L1->L2 at 10:00 while offline; B
// counts L1 = 3 at 10:30. The corrected variance (3 vs 4) stays over tolerance
// in both orders, and the count keeps exactly one open exception (D2): the
// COUNT_VARIANCE when the count arrives last, otherwise a LATE_MOVEMENT that
// superseded the earlier COUNT_VARIANCE.
const base: Omit<Scenario, 'name' | 'syncOrder' | 'expect'> = {
  setup: {
    warehouses: ['WH1'],
    products: [{ id: 'P1', tolerance: 0 }],
    locations: { WH1: ['L1', 'L2'] },
    devices: [
      { id: 'A', warehouses: ['WH1'] },
      { id: 'B', warehouses: ['WH1'] },
    ],
    initial: [{ warehouse: 'WH1', skuId: 'P1', locationId: 'L1', qty: 10 }],
  },
  actions: [
    {
      device: 'A',
      at: '10:00',
      input: {
        type: 'MOVE',
        warehouseId: 'WH1',
        skuId: 'P1',
        fromLocationId: 'L1',
        toLocationId: 'L2',
        qty: 6,
      },
    },
    {
      device: 'B',
      at: '10:30',
      input: {
        type: 'COUNT',
        warehouseId: 'WH1',
        skuId: 'P1',
        locationId: 'L1',
        qty: 3,
      },
    },
  ],
};

const balances = { 'WH1|P1|L1': 4, 'WH1|P1|L2': 6 };

export const scenarios: Scenario[] = [
  {
    ...base,
    name: 'over-tolerance count and late move (A then B)',
    syncOrder: [['A'], ['B']],
    expect: {
      balances,
      exceptions: [{ type: 'COUNT_VARIANCE', key: 'WH1|P1|L1' }],
    },
  },
  {
    ...base,
    name: 'over-tolerance count and late move (B then A)',
    syncOrder: [['B'], ['A']],
    expect: {
      balances,
      exceptions: [{ type: 'LATE_MOVEMENT', key: 'WH1|P1|L1' }],
    },
  },
];
