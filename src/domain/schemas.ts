import { z } from 'zod';
import type { Movement, MovementSource } from './types';

const id = z.string().min(1);

const common = {
  id: z.uuid(),
  warehouseId: id,
  skuId: id,
  userId: id,
  deviceId: id,
  occurredAt: z.coerce.date(),
};

const positiveInt = z.number().int().positive();

const pickSchema = z.object({
  ...common,
  type: z.literal('PICK'),
  fromLocationId: id,
  qty: positiveInt,
  ref: z.string().optional(), // pickLineId
});

const moveSchema = z
  .object({
    ...common,
    type: z.literal('MOVE'),
    fromLocationId: id,
    toLocationId: id,
    qty: positiveInt,
  })
  .refine((m) => m.fromLocationId !== m.toLocationId, {
    message: 'fromLocationId and toLocationId must differ',
    path: ['toLocationId'],
  });

const countSchema = z.object({
  ...common,
  type: z.literal('COUNT'),
  locationId: id,
  qty: z.number().int().nonnegative(),
  ref: z.string().optional(), // countTaskId
});

const adjustSchema = z.object({
  ...common,
  type: z.literal('ADJUST'),
  locationId: id,
  qty: z
    .number()
    .int()
    .refine((n) => n !== 0, { message: 'qty must not be 0' }),
  reasonCode: id,
});

const transferOutSchema = z.object({
  ...common,
  type: z.literal('TRANSFER_OUT'),
  fromLocationId: id,
  qty: positiveInt,
  transferId: z.uuid(),
  counterpartWarehouseId: id,
});

const transferInSchema = z.object({
  ...common,
  type: z.literal('TRANSFER_IN'),
  toLocationId: id,
  qty: positiveInt,
  transferId: z.uuid(),
  counterpartWarehouseId: id,
});

export const movementInputSchema = z.discriminatedUnion('type', [
  pickSchema,
  moveSchema,
  countSchema,
  adjustSchema,
  transferOutSchema,
  transferInSchema,
]);

export type MovementInput = z.infer<typeof movementInputSchema>;

/** Rows stay `unknown` so each row can be marked invalid on its own. */
export const syncBatchSchema = z.object({
  deviceId: z.string().min(1),
  schemaVersion: z.number().int(),
  sentAt: z.coerce.date(),
  movements: z.array(z.unknown()).max(500),
});

/** Maps a validated input to a Movement. `warehouseId` is intentionally dropped. */
export function toMovement(
  input: MovementInput,
  source: MovementSource,
): Movement {
  const base = {
    id: input.id,
    type: input.type,
    skuId: input.skuId,
    userId: input.userId,
    deviceId: input.deviceId,
    occurredAt: input.occurredAt,
    source,
    reasonCode: null,
    ref: null,
    counterpartWarehouseId: null,
  };
  switch (input.type) {
    case 'PICK':
      return {
        ...base,
        fromLocationId: input.fromLocationId,
        toLocationId: null,
        qty: input.qty,
        ref: input.ref ?? null,
      };
    case 'MOVE':
      return {
        ...base,
        fromLocationId: input.fromLocationId,
        toLocationId: input.toLocationId,
        qty: input.qty,
      };
    case 'COUNT':
      return {
        ...base,
        fromLocationId: null,
        toLocationId: input.locationId,
        qty: input.qty,
        ref: input.ref ?? null,
      };
    case 'ADJUST':
      return {
        ...base,
        fromLocationId: null,
        toLocationId: input.locationId,
        qty: input.qty,
        reasonCode: input.reasonCode,
      };
    case 'TRANSFER_OUT':
      return {
        ...base,
        fromLocationId: input.fromLocationId,
        toLocationId: null,
        qty: input.qty,
        ref: input.transferId,
        counterpartWarehouseId: input.counterpartWarehouseId,
      };
    case 'TRANSFER_IN':
      return {
        ...base,
        fromLocationId: null,
        toLocationId: input.toLocationId,
        qty: input.qty,
        ref: input.transferId,
        counterpartWarehouseId: input.counterpartWarehouseId,
      };
  }
}
