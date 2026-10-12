import {
  Alert,
  Button,
  Drawer,
  Group,
  Loader,
  SegmentedControl,
  Stack,
  Title,
} from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { asList } from '#/desk/as-list';
import { CountTaskForm } from '#/desk/components/CountTaskForm';
import { CountTaskTable } from '#/desk/components/CountTaskTable';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { errorMessage, RefreshNote } from '#/desk/components/RefreshNote';
import { deskCall } from '#/desk/desk-call';
import { listCountTasks, listWorkers } from '#/server/desk/count-tasks.fn';
import { listLocations } from '#/server/desk/locations.fn';

export const Route = createFileRoute('/w/$warehouseId/counts')({
  component: CountsRoute,
});

function CountsRoute() {
  const { warehouseId } = Route.useParams();
  return <CountsPage warehouseId={warehouseId} />;
}

type Status = 'OPEN' | 'DONE';

export function CountsPage({ warehouseId }: { warehouseId: string }) {
  const [status, setStatus] = useState<Status>('OPEN');
  const [drawer, setDrawer] = useState(false);
  const list = useQuery({
    queryKey: ['desk', warehouseId, 'counts', status],
    queryFn: () => deskCall(listCountTasks, { warehouseId, status }),
    placeholderData: keepPreviousData,
  });
  const workers = useQuery({
    queryKey: ['desk', 'workers'],
    queryFn: () => deskCall(listWorkers),
    refetchInterval: false,
  });
  const locations = useQuery({
    queryKey: ['desk', warehouseId, 'locations'],
    queryFn: () => deskCall(listLocations, { warehouseId }),
    refetchInterval: false,
  });
  const workerList = asList<{ id: string; name: string }>(workers.data);
  const locationList = locations.data?.ok
    ? asList(locations.data.locations)
    : [];
  const locationsFailed = locations.isError || locations.data?.ok === false;
  const workersFailed = workers.isError;
  const data = list.data;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Counts</Title>
        <Button onClick={() => setDrawer(true)}>New count task</Button>
      </Group>
      <SegmentedControl
        aria-label="Status"
        w={200}
        data={[
          { value: 'OPEN', label: 'Open' },
          { value: 'DONE', label: 'Done' },
        ]}
        value={status}
        onChange={(v) => setStatus(v as Status)}
      />
      {workersFailed && (
        <Alert color="red" role="alert">
          Couldn't load workers
        </Alert>
      )}
      {list.isError && data && <RefreshNote />}
      {!data ? (
        list.isError ? (
          <DeskErrorAlert
            error={{ code: 'INVALID', message: errorMessage(list.error) }}
          />
        ) : (
          <Loader size="sm" />
        )
      ) : data.ok ? (
        <CountTaskTable
          warehouseId={warehouseId}
          rows={data.tasks}
          workers={workerList}
        />
      ) : (
        <DeskErrorAlert error={data} onReload={() => void list.refetch()} />
      )}
      <Drawer
        opened={drawer}
        onClose={() => setDrawer(false)}
        position="right"
        size="lg"
        title="New count task"
      >
        <CountTaskForm
          warehouseId={warehouseId}
          workers={workerList}
          locations={locationList}
          locationsFailed={locationsFailed}
          workersFailed={workersFailed}
          onCreated={() => setDrawer(false)}
        />
      </Drawer>
    </Stack>
  );
}
