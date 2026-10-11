import type { Scenario } from './dsl';

// L1 starts at 10 (tolerance effectively infinite). A moves 4 out of L1 at
// 10:00 while offline; B counts L1 = 6 at 10:30, which already reflects the
// move. Either sync order must end at L1 = 6 with nothing to review.
const base: Omit<Scenario, 'name' | 'syncOrder'> = {
  setup: {
    warehouses: ['WH1'],
    products: [{ id: 'P1', tolerance: 1_000_000 }],
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
        qty: 4,
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
        qty: 6,
      },
    },
  ],
  expect: {
    balances: { 'WH1|P1|L1': 6, 'WH1|P1|L2': 4 },
    exceptions: [],
  },
};

export const scenarios: Scenario[] = [
  {
    ...base,
    name: 'count during offline move (A then B)',
    syncOrder: [['A'], ['B']],
  },
  {
    ...base,
    name: 'count during offline move (B then A)',
    syncOrder: [['B'], ['A']],
  },
];
