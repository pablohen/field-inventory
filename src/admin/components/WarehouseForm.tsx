import { Button, Stack, Text, TextInput } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { createWarehouseInputSchema } from '#/admin/warehouse-input';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { deskCall } from '#/desk/desk-call';
import { runMutation } from '#/desk/run-mutation';
import { createWarehouse } from '#/server/admin/warehouses.fn';
import type { DeskError } from '#/server/desk/warehouses.server';

export const ID_HINT =
  'Lowercase letters, digits and dashes; 2-23 characters; must start with a letter or digit.';

export function WarehouseForm({ onCreated }: { onCreated: () => void }) {
  const qc = useQueryClient();
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<Pick<
    DeskError,
    'code' | 'message'
  > | null>(null);

  const parsed = createWarehouseInputSchema.safeParse({ id, name });
  const idValid = createWarehouseInputSchema.shape.id.safeParse(id).success;

  async function submit() {
    if (!parsed.success || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await runMutation(
        () => deskCall(createWarehouse, parsed.data),
        setError,
      );
      if (res === undefined) return;
      // NOT_READY keeps the row: refresh the list either way.
      await qc.invalidateQueries({ queryKey: ['admin', 'warehouses'] });
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
        label="Warehouse id"
        description={ID_HINT}
        value={id}
        disabled={pending}
        error={id !== '' && !idValid ? 'Invalid id' : undefined}
        onChange={(e) => setId(e.currentTarget.value)}
      />
      <TextInput
        label="Name"
        value={name}
        disabled={pending}
        onChange={(e) => setName(e.currentTarget.value)}
      />
      {pending && <Text size="sm">Creating database…</Text>}
      {error && <DeskErrorAlert error={error} />}
      <Button
        onClick={() => void submit()}
        disabled={pending || !parsed.success}
        loading={pending}
      >
        Create warehouse
      </Button>
    </Stack>
  );
}
