import { Button, MultiSelect, Stack, TextInput } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { enrollDeviceInputSchema } from '#/admin/device-input';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { deskCall } from '#/desk/desk-call';
import { runMutation } from '#/desk/run-mutation';
import { enrollDevice } from '#/server/admin/devices.fn';
import type { DeskError } from '#/server/desk/warehouses.server';
import { type WarehouseOption, warehouseOptions } from './DeviceTable';

export function DeviceForm({
  warehouses,
  onCreated,
}: {
  warehouses: WarehouseOption[];
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const [id, setId] = useState('');
  const [label, setLabel] = useState('');
  const [warehouseIds, setWarehouseIds] = useState<string[]>([]);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<Pick<
    DeskError,
    'code' | 'message'
  > | null>(null);

  const parsed = enrollDeviceInputSchema.safeParse({ id, label, warehouseIds });
  const idIssue =
    id === ''
      ? undefined
      : enrollDeviceInputSchema.shape.id.safeParse(id).error?.issues[0];
  const idError = idIssue
    ? idIssue.message === 'Reserved device id'
      ? 'Reserved device id'
      : 'Use 2-64 lowercase letters, digits or dashes; start with a letter or digit'
    : undefined;

  async function submit() {
    if (!parsed.success || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await runMutation(
        () => deskCall(enrollDevice, parsed.data),
        setError,
      );
      if (res === undefined) return;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin', 'devices'] }),
        qc.invalidateQueries({ queryKey: ['admin', 'warehouses'] }),
      ]);
      if (res.ok) onCreated();
      else setError(res);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Stack gap="sm">
      <TextInput
        label="Device id"
        description="Lowercase letters, digits and dashes."
        value={id}
        disabled={pending}
        error={idError}
        onChange={(e) => setId(e.currentTarget.value)}
      />
      <TextInput
        label="Label"
        value={label}
        disabled={pending}
        onChange={(e) => setLabel(e.currentTarget.value)}
      />
      <MultiSelect
        label="Warehouses"
        data={warehouseOptions(warehouses)}
        value={warehouseIds}
        disabled={pending}
        onChange={setWarehouseIds}
      />
      {error && <DeskErrorAlert error={error} />}
      <Button
        onClick={() => void submit()}
        disabled={pending || !parsed.success}
        loading={pending}
      >
        Enroll
      </Button>
    </Stack>
  );
}
