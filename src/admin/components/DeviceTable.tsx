import {
  Alert,
  Badge,
  Button,
  Group,
  Modal,
  MultiSelect,
  Table,
  Text,
} from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { deskCall } from '#/desk/desk-call';
import {
  setDeviceRevoked,
  setDeviceWarehouses,
} from '#/server/admin/devices.fn';
import type { AdminDeviceRow } from '#/server/admin/devices.server';
import type { AdminWarehouseRow } from '#/server/admin/warehouses.server';
import type { DeskError } from '#/server/desk/warehouses.server';

export const REMOVED_HINT =
  'Rows for removed warehouses not yet synced will need attention on the device.';

const STATUS_LABEL = {
  READY: '',
  SETUP_INCOMPLETE: 'Setup incomplete',
  NEEDS_MIGRATION: 'Needs migration',
} as const;

export type WarehouseOption = Pick<AdminWarehouseRow, 'id' | 'name' | 'status'>;

export function warehouseOptions(warehouses: WarehouseOption[]) {
  return warehouses.map((w) => ({
    value: w.id,
    label:
      w.status === 'READY' ? w.name : `${w.name} (${STATUS_LABEL[w.status]})`,
  }));
}

export function DeviceTable({
  rows,
  warehouses,
}: {
  rows: AdminDeviceRow[];
  warehouses: WarehouseOption[];
}) {
  if (rows.length === 0) return <Text c="dimmed">No devices.</Text>;
  const options = warehouseOptions(warehouses);
  return (
    <Table.ScrollContainer minWidth={860}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Label</Table.Th>
            <Table.Th>Id</Table.Th>
            <Table.Th>Enrolled</Table.Th>
            <Table.Th>Warehouses</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <DeviceRowView key={r.id} row={r} options={options} />
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function DeviceRowView({
  row,
  options,
}: {
  row: AdminDeviceRow;
  options: { value: string; label: string }[];
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [saving, setSaving] = useState<string[] | null>(null);
  const [hint, setHint] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<Pick<
    DeskError,
    'code' | 'message'
  > | null>(null);

  async function run(fn: () => Promise<{ ok: true } | DeskError>) {
    if (inFlight.current) return false;
    inFlight.current = true;
    setPending(true);
    setError(null);
    setHint(false);
    let ok = false;
    try {
      const res = await fn();
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin', 'devices'] }),
        qc.invalidateQueries({ queryKey: ['admin', 'warehouses'] }),
      ]);
      if (res.ok) ok = true;
      else setError(res);
    } catch (err) {
      setError({
        code: 'INVALID',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
    return ok;
  }

  async function changeWarehouses(next: string[]) {
    if (inFlight.current) return;
    const removed = row.warehouseIds.some((id) => !next.includes(id));
    setSaving(next);
    const ok = await run(() =>
      deskCall(setDeviceWarehouses, { deviceId: row.id, warehouseIds: next }),
    );
    setSaving(null);
    if (ok && removed) setHint(true);
  }

  return (
    <>
      <Table.Tr>
        <Table.Td>{row.label}</Table.Td>
        <Table.Td>{row.id}</Table.Td>
        <Table.Td>{new Date(row.enrolledAt).toLocaleString()}</Table.Td>
        <Table.Td>
          <MultiSelect
            aria-label={`Warehouses for ${row.label}`}
            size="xs"
            miw={220}
            data={options}
            value={saving ?? row.warehouseIds}
            disabled={pending}
            onChange={(v) => void changeWarehouses(v)}
          />
        </Table.Td>
        <Table.Td>
          {row.revoked && (
            <Badge color="gray" variant="light">
              Revoked
            </Badge>
          )}
        </Table.Td>
        <Table.Td>
          {row.revoked ? (
            <Button
              size="xs"
              variant="light"
              color="green"
              disabled={pending}
              aria-label={`Restore ${row.label}`}
              onClick={() =>
                void run(() =>
                  deskCall(setDeviceRevoked, {
                    deviceId: row.id,
                    revoked: false,
                  }),
                )
              }
            >
              Restore
            </Button>
          ) : (
            <Button
              size="xs"
              variant="light"
              color="red"
              disabled={pending}
              aria-label={`Revoke ${row.label}`}
              onClick={() => setConfirm(true)}
            >
              Revoke
            </Button>
          )}
        </Table.Td>
      </Table.Tr>
      {error && (
        <Table.Tr>
          <Table.Td colSpan={6}>
            <DeskErrorAlert error={error} />
          </Table.Td>
        </Table.Tr>
      )}
      {hint && (
        <Table.Tr>
          <Table.Td colSpan={6}>
            <Alert color="yellow" role="status">
              {REMOVED_HINT}
            </Alert>
          </Table.Td>
        </Table.Tr>
      )}
      <Modal
        opened={confirm}
        onClose={() => setConfirm(false)}
        title="Revoke device"
      >
        <Text>{`Revoke ${row.label}? It will stop syncing; recorded work stays in its outbox.`}</Text>
        <Group justify="flex-end" mt="md">
          <Button variant="default" onClick={() => setConfirm(false)}>
            Cancel
          </Button>
          <Button
            color="red"
            disabled={pending}
            onClick={() => {
              setConfirm(false);
              void run(() =>
                deskCall(setDeviceRevoked, { deviceId: row.id, revoked: true }),
              );
            }}
          >
            Revoke
          </Button>
        </Group>
      </Modal>
    </>
  );
}
