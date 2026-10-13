import { z } from 'zod';

const RESERVED = new Set(['desk', '*']);

export const enrollDeviceInputSchema = z.object({
  id: z
    .string()
    .regex(/^[a-z0-9][a-z0-9-]{1,63}$/)
    .refine((id) => !RESERVED.has(id), { message: 'Reserved device id' }),
  label: z.string().trim().min(1).max(60),
  warehouseIds: z.array(z.string().min(1)),
});
export type EnrollDeviceInput = z.infer<typeof enrollDeviceInputSchema>;

export const setDeviceWarehousesRequestSchema = z.object({
  deviceId: z.string().min(1),
  warehouseIds: z.array(z.string().min(1)),
});
export const setDeviceRevokedRequestSchema = z.object({
  deviceId: z.string().min(1),
  revoked: z.boolean(),
});
