export type MovementType =
  | 'PICK'
  | 'MOVE'
  | 'COUNT'
  | 'ADJUST'
  | 'TRANSFER_OUT'
  | 'TRANSFER_IN';
export type MovementSource = 'device' | 'supervisor' | 'system';

/**
 * Location conventions: PICK and TRANSFER_OUT use fromLocationId;
 * TRANSFER_IN, COUNT and ADJUST use toLocationId; MOVE uses both.
 */
export interface Movement {
  id: string;
  type: MovementType;
  skuId: string;
  fromLocationId: string | null;
  toLocationId: string | null;
  qty: number;
  reasonCode: string | null;
  ref: string | null;
  counterpartWarehouseId: string | null;
  userId: string;
  deviceId: string;
  occurredAt: Date;
  source: MovementSource;
}

export interface BalanceKey {
  skuId: string;
  locationId: string;
}
export interface BalanceDelta extends BalanceKey {
  delta: number;
}

export type ExceptionType =
  | 'NEGATIVE_BALANCE'
  | 'COUNT_VARIANCE'
  | 'LATE_MOVEMENT'
  | 'OVER_PICK'
  | 'TRANSFER_STUCK'
  | 'CLOCK_SKEW';

export interface ExceptionDraft {
  type: ExceptionType;
  movementIds: string[];
  skuId: string | null;
  locationId: string | null;
  deviceId: string | null;
  details: Record<string, unknown>;
}
