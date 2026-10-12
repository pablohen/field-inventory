import { z } from 'zod';

export const createWarehouseInputSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{1,22}$/),
  name: z.string().trim().min(1).max(80),
});
export type CreateWarehouseInput = z.infer<typeof createWarehouseInputSchema>;

export const renameWarehouseInputSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
});

export const warehouseIdInputSchema = z.object({ id: z.string().min(1) });

export type WarehouseStatus = 'READY' | 'SETUP_INCOMPLETE' | 'NEEDS_MIGRATION';
