import { useMutation, useQueryClient } from '@tanstack/react-query';
import { balanceKeyString, movementDeltas } from '#/domain/balance';
import {
  type MovementInput,
  movementInputSchema,
  toMovement,
} from '#/domain/schemas';
import { useHandheld } from './context';

export type MovementContext = {
  warehouseId: string;
  userId: string;
  deviceId: string;
  now: Date;
  newId(): string;
};

/**
 * Builds a schema-valid input. The id and `occurredAt` are created here, once
 * per call: call it once per confirm and reuse the result across retries.
 * Throws ZodError when the fields are invalid for `kind`.
 */
export function buildMovementInput(
  kind: MovementInput['type'],
  fields: Record<string, unknown>,
  ctx: MovementContext,
): MovementInput {
  return movementInputSchema.parse({
    ...fields,
    type: kind,
    id: ctx.newId(),
    warehouseId: ctx.warehouseId,
    userId: ctx.userId,
    deviceId: ctx.deviceId,
    occurredAt: ctx.now,
  });
}

type StockRow = {
  skuId: string;
  locationId: string;
  qty: number;
  pendingDelta: number;
};
type Snapshot = [readonly unknown[], StockRow[] | undefined][];

function applyDeltas(
  rows: StockRow[],
  deltas: { skuId: string; locationId: string; delta: number }[],
  filter: { skuId?: string; locationId?: string },
): StockRow[] {
  const next = rows.map((r) => ({ ...r }));
  for (const d of deltas) {
    if (
      (filter.skuId !== undefined && filter.skuId !== d.skuId) ||
      (filter.locationId !== undefined && filter.locationId !== d.locationId)
    )
      continue;
    const k = balanceKeyString(d);
    const row = next.find((r) => balanceKeyString(r) === k);
    if (row) {
      row.qty += d.delta;
      row.pendingDelta += d.delta;
    } else {
      next.push({
        skuId: d.skuId,
        locationId: d.locationId,
        qty: d.delta,
        pendingDelta: d.delta,
      });
    }
  }
  return next;
}

/**
 * Writes the movement to the outbox with an optimistic patch of the
 * `['h', wh, 'stock', filter?]` caches. `isPending` lets screens disable
 * confirm; the guard against double submission lives in the screens.
 */
export function useRecordMovement(warehouseId: string) {
  const queryClient = useQueryClient();
  const { backend, setBanner } = useHandheld();
  const stockKey = ['h', warehouseId, 'stock'] as const;

  return useMutation<void, Error, MovementInput, Snapshot>({
    mutationKey: ['h', warehouseId, 'record'],
    networkMode: 'always',
    mutationFn: async (input) => {
      if (!backend) throw new Error('NO_BACKEND');
      await backend.call('record', input);
    },
    onMutate: async (input) => {
      await queryClient.cancelQueries({ queryKey: stockKey });
      const snapshot = queryClient.getQueriesData<StockRow[]>({
        queryKey: stockKey,
      }) as Snapshot;
      const deltas = movementDeltas(toMovement(input, 'device'));
      for (const [key, rows] of snapshot) {
        if (!Array.isArray(rows)) continue;
        const filter = (key[3] ?? {}) as {
          skuId?: string;
          locationId?: string;
        };
        queryClient.setQueryData(key, applyDeltas(rows, deltas, filter));
      }
      return snapshot;
    },
    onError: (err, _input, snapshot) => {
      for (const [key, rows] of snapshot ?? []) {
        queryClient.setQueryData(key, rows);
      }
      if (err.name === 'StorageFullError') setBanner('storage');
    },
    onSettled: () =>
      queryClient.invalidateQueries({ queryKey: ['h', warehouseId] }),
  });
}
