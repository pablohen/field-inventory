import type { Scenario } from './dsl';

// WH1 holds 5. A sends them out of WH1, B receives them into WH2, but the IN
// reaches the server before the OUT. The end state is WH1 = 0, WH2 = 5 and
// the transfer is never reported stuck.
export const scenarios: Scenario[] = [
  {
    name: 'cross-warehouse transfer, IN synced before OUT',
    setup: {
      warehouses: ['WH1', 'WH2'],
      products: [{ id: 'P1', tolerance: 0 }],
      locations: { WH1: ['L1'], WH2: ['L1'] },
      devices: [
        { id: 'A', warehouses: ['WH1'] },
        { id: 'B', warehouses: ['WH2'] },
      ],
      initial: [{ warehouse: 'WH1', skuId: 'P1', locationId: 'L1', qty: 5 }],
    },
    actions: [
      {
        device: 'A',
        at: '09:00',
        input: {
          type: 'TRANSFER_OUT',
          warehouseId: 'WH1',
          skuId: 'P1',
          fromLocationId: 'L1',
          qty: 5,
          counterpartWarehouseId: 'WH2',
        },
      },
      {
        device: 'B',
        at: '09:30',
        input: {
          type: 'TRANSFER_IN',
          warehouseId: 'WH2',
          skuId: 'P1',
          toLocationId: 'L1',
          qty: 5,
          counterpartWarehouseId: 'WH1',
        },
      },
    ],
    syncOrder: [['B'], ['A']],
    expect: {
      balances: { 'WH1|P1|L1': 0, 'WH2|P1|L1': 5 },
      exceptions: [],
    },
  },
];
