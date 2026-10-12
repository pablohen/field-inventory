import { z } from 'zod';
import type { ExceptionType } from '#/domain/types';

// Client-safe: route files import this, never exceptions.server.ts.
export const EXCEPTION_TYPES = [
  'NEGATIVE_BALANCE',
  'COUNT_VARIANCE',
  'LATE_MOVEMENT',
  'OVER_PICK',
  'TRANSFER_STUCK',
  'CLOCK_SKEW',
] as const satisfies readonly ExceptionType[];

export const exceptionFiltersSchema = z.object({
  type: z.enum(EXCEPTION_TYPES).optional(),
  skuId: z.string().optional(),
  locationId: z.string().optional(),
  userId: z.string().optional(),
  minAgeHours: z.coerce.number().nonnegative().optional(),
});
export type ExceptionFilters = z.infer<typeof exceptionFiltersSchema>;
