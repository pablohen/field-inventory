import { Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { asList } from '#/desk/as-list';
import { ConflictLanes } from '#/desk/components/ConflictLanes';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { errorMessage, RefreshNote } from '#/desk/components/RefreshNote';
import { ResolvePanel } from '#/desk/components/ResolvePanel';
import { fmtTime, Timeline } from '#/desk/components/Timeline';
import { deskCall } from '#/desk/desk-call';
import { listWorkers } from '#/server/desk/count-tasks.fn';
import {
  getExceptionDetail,
  resolveException,
} from '#/server/desk/exceptions.fn';
import { listReasonCodes } from '#/server/desk/stock.fn';
import { StatusBadge } from '#/ui/StatusBadge';

export const Route = createFileRoute('/w/$warehouseId/exceptions/$id')({
  component: ExceptionDetailRoute,
});

function ExceptionDetailRoute() {
  const { warehouseId, id } = Route.useParams();
  return <ExceptionDetailPage warehouseId={warehouseId} id={id} />;
}

export function ExceptionDetailPage({
  warehouseId,
  id,
}: {
  warehouseId: string;
  id: string;
}) {
  const detail = useQuery({
    queryKey: ['desk', warehouseId, 'exception', id],
    queryFn: () =>
      deskCall(getExceptionDetail, { warehouseId, exceptionId: id }),
  });
  const workers = useQuery({
    queryKey: ['desk', 'workers'],
    queryFn: () => deskCall(listWorkers),
    refetchInterval: false,
  });
  const reasons = useQuery({
    queryKey: ['desk', 'reason-codes', 'ADJUST'],
    queryFn: () => deskCall(listReasonCodes, { type: 'ADJUST' }),
    refetchInterval: false,
  });
  const workerList = asList<{ id: string; name: string }>(workers.data);
  const names = Object.fromEntries(workerList.map((w) => [w.id, w.name]));
  const data = detail.data;

  const back = (
    <Link to="/w/$warehouseId/exceptions" params={{ warehouseId }}>
      ← All exceptions
    </Link>
  );

  if (!data) {
    return (
      <Stack>
        {back}
        {detail.isError ? (
          <DeskErrorAlert
            error={{ code: 'INVALID', message: errorMessage(detail.error) }}
          />
        ) : (
          <Loader size="sm" />
        )}
      </Stack>
    );
  }
  if (!data.ok) {
    return (
      <Stack>
        {back}
        <DeskErrorAlert error={data} onReload={() => void detail.refetch()} />
      </Stack>
    );
  }

  const { exception: ex, byOccurredAt, bySeq, missingMovementIds } = data;
  const key =
    ex.skuId !== null && ex.locationId !== null
      ? { skuId: ex.skuId, locationId: ex.locationId }
      : null;
  const who = (u: string) => names[u] ?? u;

  return (
    <Stack>
      {back}
      {detail.isError && <RefreshNote />}
      <Group gap="sm">
        <StatusBadge kind={ex.type}>{ex.type}</StatusBadge>
        <Title order={3}>{ex.summary}</Title>
        {ex.malformed.length > 0 && (
          <StatusBadge kind="attention">data issue</StatusBadge>
        )}
      </Group>
      <Text size="sm" c="dimmed">
        SKU {ex.skuId ?? '—'} · Bin {ex.locationId ?? '—'} · Device{' '}
        {ex.deviceId ?? '—'} · Workers {ex.userIds.map(who).join(', ') || '—'} ·
        Raised {fmtTime(ex.createdAt)} ({ex.ageHours} h ago)
      </Text>
      {Object.keys(ex.details).length > 0 && (
        <Text size="sm" component="div">
          {Object.entries(ex.details).map(([k, v]) => (
            <div key={k}>
              <b>{k}</b>:{' '}
              {typeof v === 'object' ? JSON.stringify(v) : String(v)}
            </div>
          ))}
        </Text>
      )}
      {missingMovementIds.length > 0 && (
        <Text size="sm" style={{ color: 'var(--fi-danger)' }}>
          Referenced movements not found: {missingMovementIds.join(', ')}
        </Text>
      )}
      {ex.status === 'OPEN' ? (
        <ResolvePanel
          key={ex.id}
          warehouseId={warehouseId}
          exceptionId={ex.id}
          version={ex.version}
          defaults={{ skuId: ex.skuId, locationId: ex.locationId }}
          workers={workerList}
          reasonCodes={asList<{ code: string; label: string }>(reasons.data)}
          resolve={(args) => deskCall(resolveException, args.data)}
        />
      ) : (
        <Stack gap={2} data-testid="resolution">
          <div>
            <StatusBadge kind="resolved">Resolved: {ex.resolution}</StatusBadge>
          </div>
          {ex.note && <Text size="sm">Note: {ex.note}</Text>}
          <Text size="sm" c="dimmed">
            By {ex.resolvedBy ? who(ex.resolvedBy) : '—'}
            {ex.resolvedAt ? ` at ${fmtTime(ex.resolvedAt)}` : ''}
          </Text>
        </Stack>
      )}
      <ConflictLanes movements={bySeq} keyOf={key} names={names} />
      <Timeline
        byOccurredAt={byOccurredAt}
        bySeq={bySeq}
        keyOf={key}
        names={names}
      />
    </Stack>
  );
}
