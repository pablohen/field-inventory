import {
  Alert,
  Button,
  Drawer,
  Group,
  Loader,
  Stack,
  Title,
} from '@mantine/core';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link } from '@tanstack/react-router';
import { useState } from 'react';
import { LocationForm } from '#/admin/components/LocationForm';
import { LocationTable } from '#/admin/components/LocationTable';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { errorMessage, RefreshNote } from '#/desk/components/RefreshNote';
import { deskCall } from '#/desk/desk-call';
import { listLocationsAdmin } from '#/server/admin/locations.fn';
import type { AdminLocationRow } from '#/server/admin/locations.server';
import { listWarehousesAdmin } from '#/server/admin/warehouses.fn';

export const Route = createFileRoute(
  '/admin/warehouses/$warehouseId/locations',
)({
  component: LocationsRoute,
});

function LocationsRoute() {
  const { warehouseId } = Route.useParams();
  return <LocationsPage warehouseId={warehouseId} />;
}

export function LocationsPage({ warehouseId }: { warehouseId: string }) {
  const [drawer, setDrawer] = useState<{
    row: AdminLocationRow | null;
  } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'locations', warehouseId],
    queryFn: () => deskCall(listLocationsAdmin, { warehouseId }),
  });
  const warehouses = useQuery({
    queryKey: ['admin', 'warehouses'],
    queryFn: () => deskCall(listWarehousesAdmin),
  });
  const name = Array.isArray(warehouses.data)
    ? warehouses.data.find((w) => w.id === warehouseId)?.name
    : undefined;
  const data = list.data;
  const rows = data && 'locations' in data ? data.locations : null;
  const typedError = data && !('locations' in data) ? data : null;
  return (
    <Stack>
      <Link to="/admin/warehouses" className="fi-icon-link">
        <ArrowLeftIcon size={14} weight="bold" aria-hidden="true" />
        Back to warehouses
      </Link>
      <Group justify="space-between">
        <Title order={3}>{`Locations: ${name ?? warehouseId}`}</Title>
        <Button onClick={() => setDrawer({ row: null })}>New location</Button>
      </Group>
      {list.isError && data && <RefreshNote />}
      {warning && (
        <Alert
          color="yellow"
          role="status"
          withCloseButton
          onClose={() => setWarning(null)}
        >
          {warning}
        </Alert>
      )}
      {typedError ? (
        <DeskErrorAlert error={typedError} />
      ) : rows ? (
        <LocationTable
          warehouseId={warehouseId}
          rows={rows}
          onEdit={(row) => setDrawer({ row })}
          onWarning={setWarning}
        />
      ) : list.isError ? (
        <DeskErrorAlert
          error={{ code: 'INVALID', message: errorMessage(list.error) }}
        />
      ) : (
        <Loader size="sm" />
      )}
      <Drawer
        opened={drawer !== null}
        onClose={() => setDrawer(null)}
        position="right"
        size="lg"
        title={drawer?.row ? `Edit ${drawer.row.code}` : 'New location'}
      >
        {drawer && (
          <LocationForm
            key={drawer.row?.id ?? 'new'}
            warehouseId={warehouseId}
            location={drawer.row}
            onDone={() => setDrawer(null)}
          />
        )}
      </Drawer>
    </Stack>
  );
}
