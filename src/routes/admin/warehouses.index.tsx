import { Button, Drawer, Group, Loader, Stack, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { WarehouseForm } from '#/admin/components/WarehouseForm';
import { WarehouseTable } from '#/admin/components/WarehouseTable';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { errorMessage, RefreshNote } from '#/desk/components/RefreshNote';
import { deskCall } from '#/desk/desk-call';
import { listWarehousesAdmin } from '#/server/admin/warehouses.fn';

export const Route = createFileRoute('/admin/warehouses/')({
  component: WarehousesPage,
});

export function WarehousesPage() {
  const [drawer, setDrawer] = useState(false);
  const list = useQuery({
    queryKey: ['admin', 'warehouses'],
    queryFn: () => deskCall(listWarehousesAdmin),
  });
  const data = list.data;
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Warehouses</Title>
        <Button onClick={() => setDrawer(true)}>New warehouse</Button>
      </Group>
      {list.isError && data && <RefreshNote />}
      {!data ? (
        list.isError ? (
          <DeskErrorAlert
            error={{ code: 'INVALID', message: errorMessage(list.error) }}
          />
        ) : (
          <Loader size="sm" />
        )
      ) : (
        <WarehouseTable rows={Array.isArray(data) ? data : []} />
      )}
      <Drawer
        opened={drawer}
        onClose={() => setDrawer(false)}
        position="right"
        size="lg"
        title="New warehouse"
      >
        <WarehouseForm onCreated={() => setDrawer(false)} />
      </Drawer>
    </Stack>
  );
}
