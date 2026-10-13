import { Button, Group, Modal, Switch, Table, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { deskCall } from '#/desk/desk-call';
import { runMutation } from '#/desk/run-mutation';
import { setLocationActive } from '#/server/admin/locations.fn';
import type { AdminLocationRow } from '#/server/admin/locations.server';
import type { DeskError } from '#/server/desk/warehouses.server';

type RowProps = {
  warehouseId: string;
  onEdit: (row: AdminLocationRow) => void;
  onWarning: (message: string | null) => void;
};

export function LocationTable({
  rows,
  ...rest
}: RowProps & { rows: AdminLocationRow[] }) {
  if (rows.length === 0) return <Text c="dimmed">No locations.</Text>;
  return (
    <Table.ScrollContainer minWidth={560}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Code</Table.Th>
            <Table.Th>Zone</Table.Th>
            <Table.Th>Active</Table.Th>
            <Table.Th ta="right">Units on hand</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <LocationRowView key={r.id} row={r} {...rest} />
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function LocationRowView({
  warehouseId,
  row,
  onEdit,
  onWarning,
}: RowProps & { row: AdminLocationRow }) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<Pick<
    DeskError,
    'code' | 'message'
  > | null>(null);

  async function toggle(active: boolean) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await runMutation(
        () =>
          deskCall(setLocationActive, {
            warehouseId,
            locationId: row.id,
            active,
          }),
        setError,
      );
      if (res === undefined) return;
      await qc.invalidateQueries({
        queryKey: ['admin', 'locations', warehouseId],
      });
      if (res.ok) onWarning(res.warning ?? null);
      else setError(res);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function onSwitch(next: boolean) {
    if (!next && row.stockUnits > 0) setConfirm(true);
    else void toggle(next);
  }

  return (
    <>
      <Table.Tr style={row.active ? undefined : { opacity: 0.55 }}>
        <Table.Td>{row.code}</Table.Td>
        <Table.Td>{row.zone ?? ''}</Table.Td>
        <Table.Td>
          <Switch
            aria-label={`Active ${row.code}`}
            checked={row.active}
            disabled={pending}
            onChange={(e) => onSwitch(e.currentTarget.checked)}
          />
        </Table.Td>
        <Table.Td ta="right">{row.stockUnits}</Table.Td>
        <Table.Td>
          <Button
            size="xs"
            variant="default"
            disabled={pending}
            aria-label={`Edit ${row.code}`}
            onClick={() => onEdit(row)}
          >
            Edit
          </Button>
        </Table.Td>
      </Table.Tr>
      {error && (
        <Table.Tr>
          <Table.Td colSpan={5}>
            <DeskErrorAlert error={error} />
          </Table.Td>
        </Table.Tr>
      )}
      <Modal
        opened={confirm}
        onClose={() => setConfirm(false)}
        title="Deactivate location"
      >
        <Text>{`${row.code} still holds ${row.stockUnits} units. Deactivate anyway?`}</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button
            color="red"
            disabled={pending}
            onClick={() => {
              setConfirm(false);
              void toggle(false);
            }}
          >
            Deactivate
          </Button>
        </Group>
      </Modal>
    </>
  );
}
