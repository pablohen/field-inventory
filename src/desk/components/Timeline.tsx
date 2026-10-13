import { Group, Paper, SimpleGrid, Stack, Text } from '@mantine/core';
import { signed } from '#/desk/format';
import { movementDeltas } from '#/domain/balance';
import type { MovementSource, MovementType } from '#/domain/types';
import type { TimelineMovement } from '#/server/desk/exceptions.server';
import { StatusBadge } from '#/ui/StatusBadge';

export type TimelineKey = { skuId: string; locationId: string };

/** Compact UTC timestamp, stable across viewer time zones. */
export function fmtTime(iso: string): string {
  return `${iso.slice(0, 19).replace('T', ' ')}Z`;
}

/** Net effect of `m` on `key`; null when there is no key to measure against. */
export function deltaFor(
  m: TimelineMovement,
  key: TimelineKey | null,
): number | null {
  if (!key) return null;
  return movementDeltas({
    id: m.id,
    type: m.type as MovementType,
    skuId: m.skuId,
    fromLocationId: m.fromLocationId,
    toLocationId: m.toLocationId,
    qty: m.qty,
    reasonCode: m.reasonCode,
    ref: null,
    counterpartWarehouseId: null,
    userId: m.userId,
    deviceId: m.deviceId,
    occurredAt: new Date(m.occurredAt),
    source: m.source as MovementSource,
  })
    .filter((d) => d.skuId === key.skuId && d.locationId === key.locationId)
    .reduce((sum, d) => sum + d.delta, 0);
}

function Column({
  title,
  rows,
  timeField,
  seqKey,
  names,
}: {
  title: string;
  rows: (TimelineMovement & { delta: number | null })[];
  timeField: 'occurredAt' | 'receivedAt';
  seqKey: string;
  names: Record<string, string>;
}) {
  return (
    <Stack gap="xs" data-testid={`timeline-${seqKey}`}>
      <Text fw={600}>{title}</Text>
      {rows.length === 0 && (
        <Text size="sm" c="dimmed">
          No movements
        </Text>
      )}
      {rows.map((m) => (
        <Paper
          key={m.id}
          withBorder
          p="xs"
          data-involved={m.involved ? 'true' : 'false'}
          data-movement-id={m.id}
          bg={m.involved ? 'yellow.0' : undefined}
          style={
            m.involved
              ? { borderColor: 'var(--mantine-color-yellow-6)' }
              : undefined
          }
        >
          <Group justify="space-between" gap="xs" wrap="wrap">
            <Group gap={6}>
              <StatusBadge size="sm" kind={m.type}>
                {m.type}
              </StatusBadge>
              <Text size="sm">qty {m.qty}</Text>
              {m.delta !== null && (
                <Text
                  size="sm"
                  style={
                    m.delta < 0 ? { color: 'var(--fi-danger)' } : undefined
                  }
                >
                  Δ {signed(m.delta)}
                </Text>
              )}
              {m.involved && (
                <StatusBadge size="sm" kind="pending">
                  involved
                </StatusBadge>
              )}
            </Group>
            <Text size="xs" c="dimmed">
              seq {m.seq}
            </Text>
          </Group>
          <Text size="xs" c="dimmed">
            {fmtTime(m[timeField])} · {names[m.userId] ?? m.userId} ·{' '}
            {m.deviceId}
          </Text>
        </Paper>
      ))}
    </Stack>
  );
}

/** Two orderings of the same movements: physical time vs arrival. */
export function Timeline({
  byOccurredAt,
  bySeq,
  keyOf,
  names = {},
}: {
  byOccurredAt: TimelineMovement[];
  bySeq: TimelineMovement[];
  keyOf: TimelineKey | null;
  names?: Record<string, string>;
}) {
  const withDelta = (rows: TimelineMovement[]) =>
    rows.map((m) => ({ ...m, delta: deltaFor(m, keyOf) }));
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="md">
      <Column
        title="Physical order (occurred at)"
        rows={withDelta(byOccurredAt)}
        timeField="occurredAt"
        seqKey="occurred"
        names={names}
      />
      <Column
        title="Arrival order (seq)"
        rows={withDelta(bySeq)}
        timeField="receivedAt"
        seqKey="seq"
        names={names}
      />
    </SimpleGrid>
  );
}
