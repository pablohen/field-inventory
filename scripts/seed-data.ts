// Shared by the dev seed and the E2E spec. Test values for local development only.
export const DEV_PIN = '1234';

export const PRODUCTS = [
  {
    id: 'prod-1',
    sku: 'SKU-001',
    name: 'Hex bolt M8',
    barcodes: ['7890000000011'],
    categoryId: 'cat-fasteners',
    countTolerance: 2,
  },
  {
    id: 'prod-2',
    sku: 'SKU-002',
    name: 'Hex nut M8',
    barcodes: ['7890000000028'],
    categoryId: 'cat-fasteners',
  },
  {
    id: 'prod-3',
    sku: 'SKU-003',
    name: 'Washer M8',
    barcodes: ['7890000000035'],
    categoryId: 'cat-fasteners',
  },
  {
    id: 'prod-4',
    sku: 'SKU-004',
    name: 'Claw hammer',
    barcodes: ['7890000000042'],
    categoryId: 'cat-tools',
  },
  {
    id: 'prod-5',
    sku: 'SKU-005',
    name: 'Screwdriver set',
    barcodes: ['7890000000059'],
    categoryId: 'cat-tools',
  },
  {
    id: 'prod-6',
    sku: 'SKU-006',
    name: 'Tape measure 5m',
    barcodes: ['7890000000066'],
    categoryId: 'cat-tools',
  },
];

export const LOCATION_CODES = ['A-01', 'A-02', 'A-03', 'A-04', 'A-05', 'A-06'];
