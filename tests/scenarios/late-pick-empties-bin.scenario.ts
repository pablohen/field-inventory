import type { Scenario } from './dsl';

// L1 starts at 10 (tolerance effectively infinite). A picks all 10 at 10:10
// while offline; B counts L1 = 0 at 10:30, which already reflects the pick.
// Either sync order ends at L1 = 0 with no exceptions: the transient negative
// in the count-first order is netted out by the correcting auto-adjust.
const base: Omit<Scenario, 'name' | 'syncOrder'> = {
  setup: {
    warehouses: ['WH1'],
    products: [{ id: 'P1', tolerance: 1_000_000 }],
    locations: { WH1: ['L1'] },
    devices: [
      { id: 'A', warehouses: ['WH1'] },
      { id: 'B', warehouses: ['WH1'] },
    ],
    initial: [{ warehouse: 'WH1', skuId: 'P1', locationId: 'L1', qty: 10 }],
  },
  actions: [
    {
      device: 'A',
      at: '10:10',
      input: {
        type: 'PICK',
        warehouseId: 'WH1',
        skuId: 'P1',
        fromLocationId: 'L1',
        qty: 10,
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
        qty: 0,
      },
    },
  ],
  expect: {
    balances: { 'WH1|P1|L1': 0 },
    exceptions: [],
  },
};

export const scenarios: Scenario[] = [
  {
    ...base,
    name: 'late pick empties bin (pick then count)',
    syncOrder: [['A'], ['B']],
  },
  {
    ...base,
    name: 'late pick empties bin (count then pick)',
    syncOrder: [['B'], ['A']],
  },
];
