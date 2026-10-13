import { Button, Stack, TextInput } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { locationInputSchema } from '#/admin/location-input';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { deskCall } from '#/desk/desk-call';
import { runMutation } from '#/desk/run-mutation';
import { createLocation, updateLocation } from '#/server/admin/locations.fn';
import type { AdminLocationRow } from '#/server/admin/locations.server';
import type { DeskError } from '#/server/desk/warehouses.server';

export const CODE_HINT = 'Letters, digits and dashes; up to 20 characters.';

export function LocationForm({
  warehouseId,
  location,
  onDone,
}: {
  warehouseId: string;
  location?: AdminLocationRow | null;
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [code, setCode] = useState(location?.code ?? '');
  const [zone, setZone] = useState(location?.zone ?? '');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<Pick<
    DeskError,
    'code' | 'message'
  > | null>(null);

  const parsed = locationInputSchema.safeParse({ code, zone });
  const codeValid = locationInputSchema.shape.code.safeParse(code).success;

  async function submit() {
    if (!parsed.success || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await runMutation(
        () =>
          location
            ? deskCall(updateLocation, {
                warehouseId,
                locationId: location.id,
                ...parsed.data,
              })
            : deskCall(createLocation, { warehouseId, ...parsed.data }),
        setError,
      );
      if (res === undefined) return;
      await qc.invalidateQueries({
        queryKey: ['admin', 'locations', warehouseId],
      });
      if (res.ok) onDone();
      else setError(res);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Stack gap="sm">
      <TextInput
        label="Code"
        description={CODE_HINT}
        value={code}
        disabled={pending}
        error={code !== '' && !codeValid ? 'Invalid code' : undefined}
        onChange={(e) => setCode(e.currentTarget.value)}
      />
      <TextInput
        label="Zone"
        value={zone}
        disabled={pending}
        error={
          codeValid && !parsed.success ? 'Zone is too long (max 20)' : undefined
        }
        onChange={(e) => setZone(e.currentTarget.value)}
      />
      {error && <DeskErrorAlert error={error} />}
      <Button
        onClick={() => void submit()}
        disabled={pending || !parsed.success}
        loading={pending}
      >
        {location ? 'Save location' : 'Create location'}
      </Button>
    </Stack>
  );
}
