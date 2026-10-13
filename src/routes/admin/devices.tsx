import { Button, Drawer, Group, Loader, Stack, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { DeviceForm } from '#/admin/components/DeviceForm';
import { DeviceTable } from '#/admin/components/DeviceTable';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { errorMessage, RefreshNote } from '#/desk/components/RefreshNote';
import { deskCall } from '#/desk/desk-call';
import { listDevices } from '#/server/admin/devices.fn';
import { listWarehousesAdmin } from '#/server/admin/warehouses.fn';

export const Route = createFileRoute('/admin/devices')({
  component: DevicesPage,
});

export function DevicesPage() {
  const [drawer, setDrawer] = useState(false);
  const list = useQuery({
    queryKey: ['admin', 'devices'],
    queryFn: () => deskCall(listDevices),
  });
  const whs = useQuery({
    queryKey: ['admin', 'warehouses'],
    queryFn: () => deskCall(listWarehousesAdmin),
  });
  const data = list.data;
  const warehouses = Array.isArray(whs.data) ? whs.data : undefined;
  const failed = list.isError || whs.isError;
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Devices</Title>
        <Button onClick={() => setDrawer(true)} disabled={!warehouses}>
          Enroll device
        </Button>
      </Group>
      {failed && data && warehouses && <RefreshNote />}
      {!data || !warehouses ? (
        failed ? (
          <DeskErrorAlert
            error={{
              code: 'INVALID',
              message: errorMessage(list.error ?? whs.error),
            }}
          />
        ) : (
          <Loader size="sm" />
        )
      ) : (
        <DeviceTable rows={data.devices} warehouses={warehouses} />
      )}
      <Drawer
        opened={drawer}
        onClose={() => setDrawer(false)}
        position="right"
        size="lg"
        title="Enroll device"
      >
        <DeviceForm
          warehouses={warehouses ?? []}
          onCreated={() => setDrawer(false)}
        />
      </Drawer>
    </Stack>
  );
}
