import { z } from 'zod';

// Client-safe: route files import this, never stock.server.ts.

/** `nonZero` may arrive from the URL as the strings "true" / "false". */
const nonZeroSchema = z
  .union([
    z.boolean(),
    z.enum(['true', 'false']).transform((v) => v === 'true'),
  ])
  .optional();

export const stockFiltersSchema = z.object({
  skuId: z.string().optional(),
  locationId: z.string().optional(),
  nonZero: nonZeroSchema,
});
export type StockFilters = z.infer<typeof stockFiltersSchema>;

export const ledgerKeySchema = z.object({
  skuId: z.string().min(1),
  locationId: z.string().min(1),
});
export type LedgerKey = z.infer<typeof ledgerKeySchema>;

/** URL search validation: a bad shared link falls back to default filters. */
export function parseStockSearch(search: unknown): StockFilters {
  const parsed = stockFiltersSchema.safeParse(search);
  return parsed.success ? parsed.data : {};
}

/** Ledger search: bad or missing params yield `{}` (the page shows a prompt). */
export function parseLedgerSearch(search: unknown): Partial<LedgerKey> {
  const parsed = ledgerKeySchema.safeParse(search);
  return parsed.success ? parsed.data : {};
}
