import { Text } from '@mantine/core';
import { deltaFor, type TimelineKey } from '#/desk/components/Timeline';
import { laneLayout } from '#/desk/conflict-lanes';
import type { TimelineMovement } from '#/server/desk/exceptions.server';

const MAX = 12;
const W = 720;
const H = 220;
const PAD = 70;
const TOP = 50;
const BOTTOM = 170;

/** Crossing lanes: physical order (top) vs arrival order (bottom). */
export function ConflictLanes({
  movements,
  keyOf,
  names,
}: {
  movements: TimelineMovement[];
  keyOf: TimelineKey | null;
  names: Record<string, string>;
}) {
  const involved = movements.filter((m) => m.involved);
  if (involved.length === 0) return null;
  if (involved.length > MAX) {
    return (
      <Text size="sm" c="dimmed">
        Too many movements to draw — see the lists below.
      </Text>
    );
  }
  const lanes = laneLayout(
    involved.map((m) => ({
      id: m.id,
      occurredAt: m.occurredAt,
      seq: m.seq,
      type: m.type,
      delta: deltaFor(m, keyOf),
      worker: names[m.userId] ?? m.userId,
    })),
  );
  const n = lanes.length;
  const x = (rank: number) =>
    n === 1 ? W / 2 : PAD + (rank * (W - 2 * PAD)) / (n - 1);
  const lateCount = lanes.filter((l) => l.late).length;
  return (
    <svg
      role="img"
      aria-label={`Arrival order vs physical order: ${lateCount} late arrival(s)`}
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      data-testid="conflict-lanes"
    >
      <text x={8} y={TOP - 30} fontSize={11} fill="var(--fi-muted)">
        HAPPENED
      </text>
      <text x={8} y={BOTTOM + 40} fontSize={11} fill="var(--fi-muted)">
        ARRIVED
      </text>
      {lanes.map((l) => (
        <line
          key={l.id}
          data-late={l.late ? 'true' : 'false'}
          x1={x(l.happenedRank)}
          y1={TOP}
          x2={x(l.arrivedRank)}
          y2={BOTTOM}
          stroke={l.late ? 'var(--fi-danger)' : 'var(--fi-muted)'}
          strokeWidth={l.late ? 4 : 2}
        />
      ))}
      {lanes.map((l) => (
        <g key={`pt-${l.id}`}>
          <circle cx={x(l.happenedRank)} cy={TOP} r={4} fill="var(--fi-ink)" />
          <text
            x={x(l.happenedRank)}
            y={TOP - 10}
            fontSize={10}
            textAnchor="middle"
            fill="var(--fi-ink)"
          >
            {l.label}
          </text>
          <circle
            cx={x(l.arrivedRank)}
            cy={BOTTOM}
            r={4}
            fill="var(--fi-ink)"
          />
          {l.late && (
            <text
              x={x(l.arrivedRank)}
              y={BOTTOM + 20}
              fontSize={11}
              fontWeight={700}
              textAnchor="middle"
              fill="var(--fi-ink)"
            >
              late
            </text>
          )}
        </g>
      ))}
    </svg>
  );
}
