import { z } from 'zod';

export const roleSchema = z.enum(['worker', 'supervisor', 'admin']);
const pinSchema = z.string().regex(/^\d{4}$/);

export const createUserInputSchema = z.object({
  username: z.string().regex(/^[a-z][a-z0-9._-]{1,31}$/),
  name: z.string().trim().min(1).max(80),
  role: roleSchema,
  pin: pinSchema,
});
export type CreateUserInput = z.infer<typeof createUserInputSchema>;

export const updateUserInputSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  role: roleSchema.optional(),
});
export type UpdateUserInput = z.infer<typeof updateUserInputSchema>;

export const updateUserRequestSchema = updateUserInputSchema.extend({
  userId: z.string().min(1),
});
export const resetPinRequestSchema = z.object({
  userId: z.string().min(1),
  pin: pinSchema,
});
export const setUserDisabledRequestSchema = z.object({
  userId: z.string().min(1),
  disabled: z.boolean(),
});
