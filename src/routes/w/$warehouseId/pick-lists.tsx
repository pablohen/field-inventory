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
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { PickListForm } from '#/desk/components/PickListForm';
import { PickListTable } from '#/desk/components/PickListTable';
import { errorMessage, RefreshNote } from '#/desk/components/RefreshNote';
import { listWorkers } from '#/server/desk/count-tasks.fn';
import { listLocations } from '#/server/desk/locations.fn';
import { listPickLists } from '#/server/desk/pick-lists.fn';

export const Route = createFileRoute('/w/$warehouseId/pick-lists')({
  component: PickListsRoute,
});

function PickListsRoute() {
  const { warehouseId } = Route.useParams();
  return <PickListsPage warehouseId={warehouseId} />;
}

type Status = 'OPEN' | 'DONE';

export function PickListsPage({ warehouseId }: { warehouseId: string }) {
  const [status, setStatus] = useState<Status>('OPEN');
  const [drawer, setDrawer] = useState(false);
  const list = useQuery({
    queryKey: ['desk', warehouseId, 'pick-lists', status],
    queryFn: () => listPickLists({ data: { warehouseId, status } }),
    placeholderData: keepPreviousData,
  });
  const workers = useQuery({
    queryKey: ['desk', 'workers'],
    queryFn: () => listWorkers(),
    refetchInterval: false,
  });
  const locations = useQuery({
    queryKey: ['desk', warehouseId, 'locations'],
    queryFn: () => listLocations({ data: { warehouseId } }),
    refetchInterval: false,
  });
  const workerList = workers.data ?? [];
  const locationList = locations.data?.ok ? locations.data.locations : [];
  const locationsFailed = locations.isError || locations.data?.ok === false;
  const workersFailed = workers.isError;
  const data = list.data;

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Pick lists</Title>
        <Button onClick={() => setDrawer(true)}>New pick list</Button>
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
        <PickListTable
          warehouseId={warehouseId}
          rows={data.lists}
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
        title="New pick list"
      >
        <PickListForm
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
