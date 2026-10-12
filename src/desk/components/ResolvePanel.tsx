import {
  Alert,
  Button,
  NumberInput,
  Paper,
  SegmentedControl,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import type {
  ResolveInput,
  ResolveResult,
} from '#/server/desk/exceptions.server';
import type { DeskError } from '#/server/desk/warehouses.server';
import { DeskErrorAlert } from './DeskErrorAlert';

export type ResolveFn = (args: {
  data: { warehouseId: string; exceptionId: string; input: ResolveInput };
}) => Promise<ResolveResult>;

type Action = ResolveInput['action'];

const ACTIONS: { value: Action; label: string }[] = [
  { value: 'accept', label: 'Accept' },
  { value: 'adjust', label: 'Correcting adjustment' },
  { value: 'recount', label: 'Request recount' },
  { value: 'dismiss', label: 'Dismiss' },
];

export function ResolvePanel({
  warehouseId,
  exceptionId,
  version,
  defaults,
  workers,
  reasonCodes,
  resolve,
}: {
  warehouseId: string;
  exceptionId: string;
  /** The version of the exception as loaded; sent with every submit. */
  version: number;
  defaults: { skuId: string | null; locationId: string | null };
  workers: { id: string; name: string }[];
  reasonCodes: { code: string; label: string }[];
  resolve: ResolveFn;
}) {
  const qc = useQueryClient();
  const detailKey = ['desk', warehouseId, 'exception', exceptionId];
  const [action, setAction] = useState<Action>('accept');
  const [note, setNote] = useState('');
  const [qty, setQty] = useState<number | string>('');
  const [reasonCode, setReasonCode] = useState<string | null>(null);
  const [skuId, setSkuId] = useState(defaults.skuId ?? '');
  const [locationId, setLocationId] = useState(defaults.locationId ?? '');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  // Stays true after CONFLICT or success until Reload, so a poll that brings
  // a fresh version cannot silently re-enable the form.
  const [locked, setLocked] = useState(false);
  const [error, setError] = useState<Pick<
    DeskError,
    'code' | 'message'
  > | null>(null);
  const [done, setDone] = useState(false);

  const disabled = pending || locked;
  const qtyOk = typeof qty === 'number' && Number.isInteger(qty) && qty !== 0;
  const valid =
    action === 'dismiss'
      ? note.trim().length > 0
      : action === 'adjust'
        ? qtyOk &&
          reasonCode !== null &&
          skuId.trim() !== '' &&
          locationId.trim() !== ''
        : true;

  function build(): ResolveInput {
    const n = note.trim() === '' ? undefined : note;
    switch (action) {
      case 'accept':
        return { action, version, note: n };
      case 'dismiss':
        return { action, version, note };
      case 'recount':
        return {
          action,
          version,
          note: n,
          assignedUserId: assignee ?? undefined,
        };
      case 'adjust':
        return {
          action,
          version,
          note: n,
          qty: qty as number,
          reasonCode: reasonCode as string,
          skuId: skuId.trim(),
          locationId: locationId.trim(),
        };
    }
  }

  async function submit() {
    setPending(true);
    setError(null);
    try {
      const res = await resolve({
        data: { warehouseId, exceptionId, input: build() },
      });
      if (res.ok) {
        setLocked(true);
        setDone(true);
        await Promise.all([
          qc.invalidateQueries({
            queryKey: ['desk', warehouseId, 'exceptions'],
          }),
          qc.invalidateQueries({ queryKey: detailKey }),
        ]);
      } else {
        setError(res);
        if (res.code === 'CONFLICT') setLocked(true);
      }
    } catch (err) {
      setError({
        code: 'INVALID',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      setPending(false);
    }
  }

  async function reload() {
    await qc.refetchQueries({ queryKey: detailKey });
    setError(null);
    setDone(false);
    setLocked(false);
  }

  return (
    <Paper withBorder p="md">
      <Stack gap="sm">
        <Text fw={600}>Resolve</Text>
        <SegmentedControl
          aria-label="Resolution action"
          data={ACTIONS}
          value={action}
          disabled={disabled}
          onChange={(v) => setAction(v as Action)}
        />
        {action === 'adjust' && (
          <>
            <NumberInput
              label="Quantity"
              description="Signed correction applied to the bin"
              allowDecimal={false}
              value={qty}
              disabled={disabled}
              onChange={setQty}
            />
            <Select
              label="Reason"
              data={reasonCodes.map((r) => ({ value: r.code, label: r.label }))}
              value={reasonCode}
              disabled={disabled}
              onChange={setReasonCode}
            />
            <TextInput
              label="SKU"
              value={skuId}
              disabled={disabled}
              onChange={(e) => setSkuId(e.currentTarget.value)}
            />
            <TextInput
              label="Bin"
              value={locationId}
              disabled={disabled}
              onChange={(e) => setLocationId(e.currentTarget.value)}
            />
          </>
        )}
        {action === 'recount' && (
          <Select
            label="Assign to (optional)"
            clearable
            data={workers.map((w) => ({ value: w.id, label: w.name }))}
            value={assignee}
            disabled={disabled}
            onChange={setAssignee}
          />
        )}
        <Textarea
          label={action === 'dismiss' ? 'Note (required)' : 'Note (optional)'}
          value={note}
          disabled={disabled}
          onChange={(e) => setNote(e.currentTarget.value)}
        />
        {error && (
          <DeskErrorAlert error={error} onReload={() => void reload()} />
        )}
        {done && <Alert color="green">Resolved.</Alert>}
        <Button
          onClick={() => void submit()}
          disabled={disabled || !valid}
          loading={pending}
        >
          Resolve
        </Button>
      </Stack>
    </Paper>
  );
}
