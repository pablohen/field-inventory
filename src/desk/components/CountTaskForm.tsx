import {
  Alert,
  Button,
  MultiSelect,
  SegmentedControl,
  Select,
  Stack,
} from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { type CountScope, countScopeSchema } from '#/desk/count-scope';
import { deskCall } from '#/desk/desk-call';
import { createCountTask } from '#/server/desk/count-tasks.fn';
import type { LocationRow } from '#/server/desk/locations.server';
import type { DeskError } from '#/server/desk/warehouses.server';
import { DeskErrorAlert } from './DeskErrorAlert';
import { ProductPicker } from './ProductPicker';

type Worker = { id: string; name: string };
type Kind = 'locations' | 'zone' | 'skus';

const KINDS: { value: Kind; label: string }[] = [
  { value: 'locations', label: 'Bins' },
  { value: 'zone', label: 'Zone' },
  { value: 'skus', label: 'SKUs' },
];

export function CountTaskForm({
  warehouseId,
  workers,
  locations,
  locationsFailed = false,
  workersFailed = false,
  onCreated,
}: {
  warehouseId: string;
  workers: Worker[];
  locations: LocationRow[];
  locationsFailed?: boolean;
  workersFailed?: boolean;
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const [kind, setKind] = useState<Kind>('locations');
  const [binIds, setBinIds] = useState<string[]>([]);
  const [zone, setZone] = useState<string | null>(null);
  const [skus, setSkus] = useState<string[]>([]);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<Pick<
    DeskError,
    'code' | 'message'
  > | null>(null);

  const zones = [
    ...new Set(locations.map((l) => l.zone).filter((z): z is string => !!z)),
  ].sort();

  const candidate =
    kind === 'locations'
      ? { locations: binIds }
      : kind === 'zone'
        ? { zone: zone ?? '' }
        : { skus };
  const parsed = countScopeSchema.safeParse(candidate);
  const scope: CountScope | null = parsed.success ? parsed.data : null;

  async function create() {
    if (!scope || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await deskCall(createCountTask, {
        warehouseId,
        scope,
        ...(assignee ? { assignedUserId: assignee } : {}),
      });
      if (res.ok) {
        await qc.invalidateQueries({
          queryKey: ['desk', warehouseId, 'counts'],
        });
        onCreated();
      } else {
        setError(res);
      }
    } catch (err) {
      setError({
        code: 'INVALID',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Stack gap="sm">
      <SegmentedControl
        aria-label="Scope type"
        data={KINDS}
        value={kind}
        disabled={pending}
        onChange={(v) => setKind(v as Kind)}
      />
      {locationsFailed && kind !== 'skus' && (
        <Alert color="red" role="alert">
          Couldn't load bins
        </Alert>
      )}
      {kind === 'locations' && (
        <MultiSelect
          label="Bins"
          searchable
          data={locations.map((l) => ({
            value: l.id,
            label: l.active ? l.code : `${l.code} (inactive)`,
          }))}
          value={binIds}
          disabled={pending}
          onChange={setBinIds}
        />
      )}
      {kind === 'zone' && (
        <Select
          label="Zone"
          searchable
          data={zones}
          value={zone}
          disabled={pending}
          onChange={setZone}
        />
      )}
      {kind === 'skus' && (
        <ProductPicker
          multiple
          label="SKUs"
          value={skus}
          disabled={pending}
          onChange={setSkus}
        />
      )}
      {workersFailed && (
        <Alert color="red" role="alert">
          Couldn't load workers
        </Alert>
      )}
      <Select
        label="Assign to (optional)"
        clearable
        data={workers.map((w) => ({ value: w.id, label: w.name }))}
        value={assignee}
        disabled={pending}
        onChange={setAssignee}
      />
      {error && <DeskErrorAlert error={error} />}
      <Button
        onClick={() => void create()}
        disabled={pending || !scope}
        loading={pending}
      >
        Create count task
      </Button>
    </Stack>
  );
}
