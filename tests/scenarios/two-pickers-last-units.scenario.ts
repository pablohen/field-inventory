import type { Scenario } from './dsl';

// L1 holds 3. Pickers A and B each pick all 3 while offline.
// Whoever syncs second drives L1 to -3 and raises one NEGATIVE_BALANCE.
const base: Omit<Scenario, 'name' | 'syncOrder'> = {
  setup: {
    warehouses: ['WH1'],
    products: [{ id: 'P1', tolerance: 0 }],
    locations: { WH1: ['L1'] },
    devices: [
      { id: 'A', warehouses: ['WH1'] },
      { id: 'B', warehouses: ['WH1'] },
    ],
    initial: [{ warehouse: 'WH1', skuId: 'P1', locationId: 'L1', qty: 3 }],
  },
  actions: ['A', 'B'].map((device) => ({
    device,
    at: '10:00',
    input: {
      type: 'PICK',
      warehouseId: 'WH1',
      skuId: 'P1',
      fromLocationId: 'L1',
      qty: 3,
    },
  })),
  expect: {
    balances: { 'WH1|P1|L1': -3 },
    exceptions: [{ type: 'NEGATIVE_BALANCE', key: 'WH1|P1|L1' }],
  },
};

export const scenarios: Scenario[] = [
  {
    ...base,
    name: 'two pickers, last units (A then B)',
    syncOrder: [['A'], ['B']],
  },
  {
    ...base,
    name: 'two pickers, last units (B then A)',
    syncOrder: [['B'], ['A']],
  },
];
