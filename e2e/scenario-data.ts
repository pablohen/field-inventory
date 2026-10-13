import { initialQty, LOCATION_CODES, PRODUCTS } from '../scripts/seed-data';

const WH = 'wh-1';

/** Everything a scenario needs to scan (codes, barcode) and to assert (ids, display values). */
function product(index: number) {
  const p = PRODUCTS[index];
  return {
    skuId: p.id,
    /** SKU code, as the desk stock table displays it. */
    sku: p.sku,
    barcode: p.barcodes[0],
  };
}

function location(index: number) {
  const code = LOCATION_CODES[index];
  // The desk exceptions list shows the raw ids; the desk stock table shows the codes.
  return { code, id: `${WH}-${code}` };
}

/** Product i is stocked at location i, so this is the seeded quantity there. */
function seededQty(index: number): number {
  const qty = initialQty(index, index);
  if (qty === null) throw new Error(`seed has no stock for product ${index}`);
  return qty;
}

/** Concurrent-edit scenarios on wh-1, derived from the dev seed. */
export const CONTESTS = {
  /** A moves part of the stock away, then B counts the old location. (prod-1, tolerance 2) */
  countVsMove: {
    ...product(0),
    from: location(0),
    to: location(1),
    initialQty: seededQty(0),
    moveQty: 6,
    countQty: 4,
  },
  /** A writes off every unit, then B moves them (prod-4, Tools tolerance 0). */
  lastUnits: {
    ...product(3),
    from: location(3),
    to: location(4),
    initialQty: seededQty(3),
    adjustReason: 'Damaged',
  },
} as const;
