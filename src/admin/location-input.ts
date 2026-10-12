import { z } from 'zod';

export const locationInputSchema = z.object({
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9-]{1,20}$/),
  zone: z.string().trim().max(20).optional().nullable(),
});
export type LocationInput = z.infer<typeof locationInputSchema>;

export const listLocationsAdminInputSchema = z.object({
  warehouseId: z.string().min(1),
});
export const createLocationInputSchema = locationInputSchema.extend({
  warehouseId: z.string().min(1),
});
export const updateLocationInputSchema = locationInputSchema.extend({
  warehouseId: z.string().min(1),
  locationId: z.string().min(1),
});
export const setLocationActiveInputSchema = z.object({
  warehouseId: z.string().min(1),
  locationId: z.string().min(1),
  active: z.boolean(),
});
