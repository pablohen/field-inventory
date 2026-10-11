import type { Scenario } from './dsl';

// L1 starts at 10 (tolerance 0). B counts 10 at 10:30. A picked 3 at 10:00
// but only syncs afterwards, so the pick lands behind the count: L1 = 7 and
// the pick is flagged LATE_MOVEMENT.
export const scenarios: Scenario[] = [
  {
    name: 'late pick after count',
    setup: {
      warehouses: ['WH1'],
      products: [{ id: 'P1', tolerance: 0 }],
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
        at: '10:00',
        input: {
          type: 'PICK',
          warehouseId: 'WH1',
          skuId: 'P1',
          fromLocationId: 'L1',
          qty: 3,
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
          qty: 10,
        },
      },
    ],
    syncOrder: [['B'], ['A']],
    expect: {
      balances: { 'WH1|P1|L1': 7 },
      exceptions: [{ type: 'LATE_MOVEMENT', key: 'WH1|P1|L1' }],
    },
  },
];
