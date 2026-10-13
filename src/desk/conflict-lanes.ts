import { signed } from '#/desk/components/Timeline';

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
  label: string;
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
    const h = happened.get(m.id) as number;
    const a = arrived.get(m.id) as number;
    const late = ms.some(
      (o) =>
        o.id !== m.id &&
        (happened.get(o.id) as number) > h &&
        (arrived.get(o.id) as number) < a,
    );
    const label =
      m.delta === null
        ? `${m.type} · ${m.worker}`
        : `${m.type} ${signed(m.delta)} · ${m.worker}`;
    return { id: m.id, happenedRank: h, arrivedRank: a, late, label };
  });
}
