import { signed } from '#/desk/format';

export type LaneInput = {
  id: string;
  occurredAt: string;
  seq: number;
  type: string;
  delta: number | null;
  worker: string;
};

export type LaneEntry = {
  id: string;
  happenedRank: number;
  arrivedRank: number;
  late: boolean;
  /** `TYPE delta · worker` */
  label: string;
  /** `TYPE delta` (just `TYPE` without a delta); what is drawn on the chart. */
  shortLabel: string;
  worker: string;
};

/** Ranks movements by physical time and by arrival; "late" = overtaken on arrival. */
export function laneLayout(ms: LaneInput[]): LaneEntry[] {
  const byHappened = [...ms].sort((a, b) =>
    a.occurredAt < b.occurredAt
      ? -1
      : a.occurredAt > b.occurredAt
        ? 1
        : a.seq - b.seq,
  );
  const bySeq = [...ms].sort((a, b) => a.seq - b.seq);
  const happened = new Map(byHappened.map((m, i) => [m.id, i]));
  const arrived = new Map(bySeq.map((m, i) => [m.id, i]));
  return ms.map((m) => {
    const h = happened.get(m.id) ?? 0;
    const a = arrived.get(m.id) ?? 0;
    const late = ms.some(
      (o) =>
        o.id !== m.id &&
        (happened.get(o.id) ?? 0) > h &&
        (arrived.get(o.id) ?? 0) < a,
    );
    const shortLabel =
      m.delta === null ? m.type : `${m.type} ${signed(m.delta)}`;
    return {
      id: m.id,
      happenedRank: h,
      arrivedRank: a,
      late,
      label: `${shortLabel} · ${m.worker}`,
      shortLabel,
      worker: m.worker,
    };
  });
}

export const LANE_W = 720;
export const LANE_PAD = 70;
export const LANE_ROWS = 3;
/** Estimated text width per character at the chart's 10-unit font. */
export const CHAR_W = 6.5;
const HALF_MAX_LABEL = 40;

export type LaneSlot = {
  x: number;
  /** Label x, clamped so the text stays inside the viewBox. */
  labelX: number;
  /** Staggered row, 0..LANE_ROWS-1, cycling by rank. */
  row: number;
};

/** Pure geometry: x position and label row for a rank among n points. */
export function laneSlot(rank: number, n: number): LaneSlot {
  const x =
    n <= 1 ? LANE_W / 2 : LANE_PAD + (rank * (LANE_W - 2 * LANE_PAD)) / (n - 1);
  const labelX = Math.min(LANE_W - HALF_MAX_LABEL, Math.max(HALF_MAX_LABEL, x));
  return { x, labelX, row: rank % LANE_ROWS };
}
