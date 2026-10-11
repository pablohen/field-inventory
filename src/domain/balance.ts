import type {
  BalanceDelta,
  BalanceKey,
  ExceptionDraft,
  Movement,
} from './types';

export function balanceKeyString(k: BalanceKey): string {
  return `${k.skuId}|${k.locationId}`;
}

export function movementDeltas(m: Movement): BalanceDelta[] {
  const at = (locationId: string | null, delta: number): BalanceDelta[] =>
    locationId === null ? [] : [{ skuId: m.skuId, locationId, delta }];
  switch (m.type) {
    case 'PICK':
    case 'TRANSFER_OUT':
      return at(m.fromLocationId, -m.qty);
    case 'TRANSFER_IN':
    case 'ADJUST':
      return at(m.toLocationId, m.qty);
    case 'MOVE':
      return [...at(m.fromLocationId, -m.qty), ...at(m.toLocationId, m.qty)];
    case 'COUNT':
      return [];
  }
}

export function computeBalances(ms: Movement[]): Map<string, number> {
  const balances = new Map<string, number>();
  for (const m of ms) {
    for (const d of movementDeltas(m)) {
      const key = balanceKeyString(d);
      balances.set(key, (balances.get(key) ?? 0) + d.delta);
    }
  }
  return balances;
}

export function detectNegative(
  m: Movement,
  before: Map<string, number>,
  openNegativeKeys: Set<string>,
): ExceptionDraft[] {
  const totals = new Map<string, BalanceDelta>();
  for (const d of movementDeltas(m)) {
    const key = balanceKeyString(d);
    const prev = totals.get(key);
    totals.set(key, { ...d, delta: (prev?.delta ?? 0) + d.delta });
  }
  const drafts: ExceptionDraft[] = [];
  for (const [key, d] of totals) {
    const b = before.get(key) ?? 0;
    const after = b + d.delta;
    if (after < 0 && !openNegativeKeys.has(key)) {
      drafts.push({
        type: 'NEGATIVE_BALANCE',
        movementIds: [m.id],
        skuId: d.skuId,
        locationId: d.locationId,
        deviceId: m.deviceId,
        details: { before: b, after },
      });
    }
  }
  return drafts;
}
