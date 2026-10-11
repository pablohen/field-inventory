import type { Scenario } from './dsl';

// A's clock runs 10 minutes fast. Its count is accepted (it matches the
// balance), but the batch's sentAt is far from server time: one CLOCK_SKEW.
export const scenarios: Scenario[] = [
  {
    name: 'skewed device count',
    setup: {
      warehouses: ['WH1'],
      products: [{ id: 'P1', tolerance: 0 }],
      locations: { WH1: ['L1'] },
      devices: [{ id: 'A', warehouses: ['WH1'], skewMs: 600_000 }],
      initial: [{ warehouse: 'WH1', skuId: 'P1', locationId: 'L1', qty: 10 }],
    },
    actions: [
      {
        device: 'A',
        at: '10:00',
        input: {
          type: 'COUNT',
          warehouseId: 'WH1',
          skuId: 'P1',
          locationId: 'L1',
          qty: 10,
        },
      },
    ],
    syncOrder: [['A']],
    expect: {
      balances: { 'WH1|P1|L1': 10 },
      exceptions: [{ type: 'CLOCK_SKEW' }],
    },
  },
];
