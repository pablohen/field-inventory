import { Badge, Button, Group, Table, Text, TextInput } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { renameWarehouseInputSchema } from '#/admin/warehouse-input';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { deskCall } from '#/desk/desk-call';
import { runMutation } from '#/desk/run-mutation';
import {
  finishWarehouseSetup,
  renameWarehouse,
} from '#/server/admin/warehouses.fn';
import type {
  AdminWarehouseRow,
  WarehouseStatus,
} from '#/server/admin/warehouses.server';
import type { DeskError } from '#/server/desk/warehouses.server';

const STATUS: Record<WarehouseStatus, { label: string; color: string }> = {
  READY: { label: 'Ready', color: 'green' },
  SETUP_INCOMPLETE: { label: 'Setup incomplete', color: 'red' },
  NEEDS_MIGRATION: { label: 'Needs migration', color: 'orange' },
};

export function WarehouseTable({ rows }: { rows: AdminWarehouseRow[] }) {
  if (rows.length === 0) return <Text c="dimmed">No warehouses.</Text>;
  return (
    <Table.ScrollContainer minWidth={720}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Id</Table.Th>
            <Table.Th>Database</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th ta="right">Devices</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <WarehouseRowView key={r.id} row={r} />
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function WarehouseRowView({ row }: { row: AdminWarehouseRow }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<Pick<
    DeskError,
    'code' | 'message'
  > | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState(row.name);

  const parsedName = renameWarehouseInputSchema.safeParse({
    id: row.id,
    name,
  });

  async function run(
    fn: () => Promise<{ ok: true } | DeskError>,
    onOk?: () => void,
  ) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await runMutation(fn, setError);
      if (res === undefined) return;
      await qc.invalidateQueries({ queryKey: ['admin', 'warehouses'] });
      if (res.ok) onOk?.();
      else setError(res);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const status = STATUS[row.status];
  const setupLabel =
    row.status === 'SETUP_INCOMPLETE'
      ? 'Finish setup'
      : row.status === 'NEEDS_MIGRATION'
        ? 'Run migrations'
        : null;

  return (
    <>
      <Table.Tr>
        <Table.Td>
          {renaming ? (
            <Group gap="xs" wrap="nowrap">
              <TextInput
                aria-label={`Name for ${row.id}`}
                size="xs"
                value={name}
                disabled={pending}
                error={!parsedName.success ? 'Name is required' : undefined}
                onChange={(e) => setName(e.currentTarget.value)}
              />
              <Button
                size="xs"
                disabled={pending || !parsedName.success}
                loading={pending}
                onClick={() =>
                  parsedName.success &&
                  void run(
                    () => deskCall(renameWarehouse, parsedName.data),
                    () => setRenaming(false),
                  )
                }
              >
                Save
              </Button>
              <Button
                size="xs"
                variant="default"
                disabled={pending}
                onClick={() => {
                  setRenaming(false);
                  setName(row.name);
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </Group>
          ) : (
            row.name
          )}
        </Table.Td>
        <Table.Td>{row.id}</Table.Td>
        <Table.Td>{row.tursoDbName}</Table.Td>
        <Table.Td>
          <Badge color={status.color} variant="light">
            {status.label}
          </Badge>
        </Table.Td>
        <Table.Td ta="right">{row.deviceCount}</Table.Td>
        <Table.Td>
          <Group gap="xs">
            {!renaming && (
              <Button
                size="xs"
                variant="default"
                disabled={pending}
                aria-label={`Rename ${row.id}`}
                onClick={() => {
                  setName(row.name);
                  setRenaming(true);
                }}
              >
                Rename
              </Button>
            )}
            {setupLabel && (
              <Button
                size="xs"
                variant="light"
                disabled={pending}
                loading={pending && !renaming}
                onClick={() =>
                  void run(() => deskCall(finishWarehouseSetup, { id: row.id }))
                }
              >
                {setupLabel}
              </Button>
            )}
            <Link
              to="/admin/warehouses/$warehouseId/locations"
              params={{ warehouseId: row.id }}
            >
              Locations
            </Link>
          </Group>
        </Table.Td>
      </Table.Tr>
      {error && (
        <Table.Tr>
          <Table.Td colSpan={6}>
            <DeskErrorAlert error={error} />
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}
