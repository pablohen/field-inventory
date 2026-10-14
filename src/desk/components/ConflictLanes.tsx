import { Text } from '@mantine/core';
import { deltaFor, type TimelineKey } from '#/desk/components/Timeline';
import { LANE_W, laneLayout, laneSlot } from '#/desk/conflict-lanes';
import type { TimelineMovement } from '#/server/desk/exceptions.server';

const MAX = 12;
const H = 260;
const TOP = 72;
const BOTTOM = 172;
const ROW_H = 12;

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
  // Every movement on the bin, like the lists below: the late arrival that
  // explains an exception is usually not one of its involved movements.
  if (movements.length < 2) return null;
  if (movements.length > MAX) {
    return (
      <Text size="sm" c="dimmed">
        Too many movements to draw — see the lists below.
      </Text>
    );
  }
  const lanes = laneLayout(
    movements.map((m) => ({
      id: m.id,
      occurredAt: m.occurredAt,
      seq: m.seq,
      type: m.type,
      delta: deltaFor(m, keyOf),
      worker: names[m.userId] ?? m.userId,
      observed: m.type === 'COUNT' ? m.qty : null,
      involved: m.involved,
    })),
  );
  const n = lanes.length;
  const lateCount = lanes.filter((l) => l.late).length;
  return (
    <svg
      role="img"
      aria-label={`Arrival order vs physical order: ${lateCount} late arrival(s)`}
      viewBox={`0 0 ${LANE_W} ${H}`}
      width="100%"
      data-testid="conflict-lanes"
    >
      <text x={8} y={12} fontSize={11} fill="var(--fi-muted)">
        HAPPENED
      </text>
      <text x={8} y={H - 6} fontSize={11} fill="var(--fi-muted)">
        ARRIVED
      </text>
      {lanes.map((l) => {
        const top = laneSlot(l.happenedRank, n);
        const bot = laneSlot(l.arrivedRank, n);
        return (
          <line
            key={l.id}
            data-late={l.late ? 'true' : 'false'}
            x1={top.x}
            y1={TOP}
            x2={bot.x}
            y2={BOTTOM}
            stroke={l.late ? 'var(--fi-danger)' : 'var(--fi-muted)'}
            strokeWidth={l.late ? 4 : 2}
          >
            <title>{l.label}</title>
          </line>
        );
      })}
      {lanes.map((l) => {
        const top = laneSlot(l.happenedRank, n);
        const bot = laneSlot(l.arrivedRank, n);
        return (
          <g key={`pt-${l.id}`}>
            <circle
              cx={top.x}
              cy={TOP}
              r={l.involved ? 6 : 4}
              fill={l.involved ? 'var(--fi-signal)' : 'var(--fi-ink)'}
              stroke="var(--fi-ink)"
              strokeWidth={l.involved ? 2 : 0}
              data-involved={l.involved ? 'true' : 'false'}
            >
              <title>{l.label}</title>
            </circle>
            <text
              x={top.labelX}
              y={TOP - 10 - top.row * ROW_H}
              fontSize={10}
              fontWeight={l.involved ? 700 : 400}
              textAnchor="middle"
              fill="var(--fi-ink)"
            >
              {l.shortLabel}
            </text>
            <circle
              cx={bot.x}
              cy={BOTTOM}
              r={l.involved ? 6 : 4}
              fill={l.involved ? 'var(--fi-signal)' : 'var(--fi-ink)'}
              stroke="var(--fi-ink)"
              strokeWidth={l.involved ? 2 : 0}
            >
              <title>{l.label}</title>
            </circle>
            <text
              x={bot.labelX}
              y={BOTTOM + 16 + bot.row * ROW_H}
              fontSize={10}
              fontWeight={l.involved ? 700 : 400}
              textAnchor="middle"
              fill="var(--fi-ink)"
            >
              {l.shortLabel}
            </text>
            {l.late && (
              <text
                x={bot.labelX}
                y={BOTTOM + 16 + 3 * ROW_H + 8}
                fontSize={11}
                fontWeight={700}
                textAnchor="middle"
                fill="var(--fi-ink)"
              >
                late
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
