import { z } from 'zod';

export const MOVEMENT_TYPES = [
  'PICK',
  'MOVE',
  'COUNT',
  'ADJUST',
  'TRANSFER_OUT',
  'TRANSFER_IN',
] as const;

export const productInputSchema = z.object({
  sku: z.string().regex(/^[A-Za-z0-9-]{1,32}$/),
  name: z.string().trim().min(1).max(120),
  barcodes: z
    .array(z.string().regex(/^[0-9A-Za-z]{4,32}$/))
    .max(10)
    .refine((b) => new Set(b).size === b.length, {
      message: 'Duplicate barcodes',
    }),
  uom: z.string().trim().min(1).max(8).default('EA'),
  categoryId: z.string().min(1).optional().nullable(),
  countTolerance: z.number().int().min(0).optional().nullable(),
});
export type ProductInput = z.input<typeof productInputSchema>;

export const categoryInputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  countTolerance: z.number().int().min(0),
});
export type CategoryInput = z.input<typeof categoryInputSchema>;

export const reasonCodeInputSchema = z.object({
  code: z.string().regex(/^[A-Z][A-Z0-9_]{1,23}$/),
  label: z.string().trim().min(1).max(60),
  appliesTo: z.array(z.enum(MOVEMENT_TYPES)).min(1),
});
export type ReasonCodeInput = z.input<typeof reasonCodeInputSchema>;

export const listProductsInputSchema = z.object({
  search: z.string().optional(),
});
export const updateProductInputSchema = productInputSchema.extend({
  productId: z.string().min(1),
});
export const updateCategoryInputSchema = categoryInputSchema.extend({
  categoryId: z.string().min(1),
});
// The update path takes the code from the row; the strict create regex is not
// re-applied so system codes reach the core's explicit INVALID check.
export const updateReasonCodeInputSchema = reasonCodeInputSchema.extend({
  code: z.string().min(1),
});

/** URL search validation: a bad shared link falls back to an empty search. */
export function parseProductSearch(search: unknown): { search?: string } {
  const parsed = listProductsInputSchema.safeParse(search);
  if (!parsed.success || !parsed.data.search) return {};
  return { search: parsed.data.search };
}
