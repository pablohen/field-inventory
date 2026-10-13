import type { Scenario } from './dsl';

// Tolerance 2. L1 starts at 10. A moves 6 L1->L2 at 10:00 while offline; B
// counts L1 = 4 at 10:30, which already reflects the move. If B syncs first the
// count raises COUNT_VARIANCE (observed 4, expected 10); A's late move then
// makes the count consistent and supersedes that exception (D1).
const base: Omit<Scenario, 'name' | 'syncOrder'> = {
  setup: {
    warehouses: ['WH1'],
    products: [{ id: 'P1', tolerance: 2 }],
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
        qty: 4,
      },
    },
  ],
  expect: {
    balances: { 'WH1|P1|L1': 4, 'WH1|P1|L2': 6 },
    exceptions: [],
  },
};

export const scenarios: Scenario[] = [
  {
    ...base,
    name: 'count before late move (A then B)',
    syncOrder: [['A'], ['B']],
  },
  {
    ...base,
    name: 'count before late move (B then A)',
    syncOrder: [['B'], ['A']],
  },
];
