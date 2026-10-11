import type { ExceptionDraft, Movement } from '#/domain/types';

const MS_PER_HOUR = 3_600_000;

/** Raises OVER_PICK only on the pick that first crosses the requested qty. */
export function detectOverPick(
  m: Movement,
  line: { id: string; qtyRequested: number } | null,
  pickedBefore: number,
): ExceptionDraft[] {
  if (!line) return [];
  const pickedAfter = pickedBefore + m.qty;
  if (pickedBefore <= line.qtyRequested && pickedAfter > line.qtyRequested) {
    return [
      {
        type: 'OVER_PICK',
        movementIds: [m.id],
        skuId: m.skuId,
        locationId: m.fromLocationId,
        deviceId: m.deviceId,
        details: { requested: line.qtyRequested, pickedAfter },
      },
    ];
  }
  return [];
}

/** Flags TRANSFER_OUT movements with no matching TRANSFER_IN after the threshold. */
export function findStuckTransfers(
  outs: Movement[],
  inRefs: Set<string>,
  alreadyFlagged: Set<string>,
  now: Date,
  thresholdHours: number,
): ExceptionDraft[] {
  const drafts: ExceptionDraft[] = [];
  for (const out of outs) {
    if (out.ref === null) continue;
    if (inRefs.has(out.ref) || alreadyFlagged.has(out.ref)) continue;
    const ageHours = (now.getTime() - out.occurredAt.getTime()) / MS_PER_HOUR;
    if (ageHours > thresholdHours) {
      drafts.push({
        type: 'TRANSFER_STUCK',
        movementIds: [out.id],
        skuId: out.skuId,
        locationId: out.fromLocationId,
        deviceId: out.deviceId,
        details: {
          transferId: out.ref,
          counterpartWarehouseId: out.counterpartWarehouseId,
          ageHours,
        },
      });
    }
  }
  return drafts;
}

/** Raises CLOCK_SKEW when the device clock differs from the server by more than the threshold. */
export function detectClockSkew(
  deviceId: string,
  sentAt: Date,
  serverNow: Date,
  thresholdMs: number,
  hasOpen: boolean,
): ExceptionDraft | null {
  const skewMs = sentAt.getTime() - serverNow.getTime();
  if (Math.abs(skewMs) > thresholdMs && !hasOpen) {
    return {
      type: 'CLOCK_SKEW',
      movementIds: [],
      skuId: null,
      locationId: null,
      deviceId,
      details: { skewMs },
    };
  }
  return null;
}
