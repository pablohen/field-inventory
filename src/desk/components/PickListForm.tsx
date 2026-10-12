import {
  ActionIcon,
  Alert,
  Button,
  Group,
  NumberInput,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import type { LocationRow } from '#/server/desk/locations.server';
import { createPickList, suggestPickList } from '#/server/desk/pick-lists.fn';
import { getStock } from '#/server/desk/stock.fn';
import type { DeskError } from '#/server/desk/warehouses.server';
import { DeskErrorAlert } from './DeskErrorAlert';

type Worker = { id: string; name: string };
type Request = { skuId: string; qty: number | string };
type Line = { skuId: string; locationId: string | null; qty: number };
type Suggestion = {
  lines: Line[];
  shortfalls: { skuId: string; missing: number }[];
};
type Err = Pick<DeskError, 'code' | 'message'>;

export function PickListForm({
  warehouseId,
  workers,
  locations,
  onCreated,
}: {
  warehouseId: string;
  workers: Worker[];
  /** Used for bin labels and as the fallback when a SKU has no stock. */
  locations: LocationRow[];
  onCreated: () => void;
}) {
  const qc = useQueryClient();
  const [requests, setRequests] = useState<Request[]>([{ skuId: '', qty: '' }]);
  const [suggestion, setSuggestion] = useState<Suggestion | null>(null);
  const [bins, setBins] = useState<(string | null)[]>([]);
  const [assignee, setAssignee] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<Err | null>(null);

  const validRequests = requests.every(
    (r) =>
      r.skuId.trim() !== '' &&
      typeof r.qty === 'number' &&
      Number.isInteger(r.qty) &&
      r.qty > 0,
  );

  const skuIds = suggestion
    ? [...new Set(suggestion.lines.map((l) => l.skuId))]
    : [];
  const stockQueries = useQueries({
    queries: skuIds.map((skuId) => ({
      queryKey: ['desk', warehouseId, 'stock', { skuId, nonZero: true }],
      queryFn: () =>
        getStock({ data: { warehouseId, filters: { skuId, nonZero: true } } }),
      refetchInterval: false as const,
    })),
  });
  const stockBySku = new Map(
    skuIds.map((skuId, i) => [skuId, stockQueries[i]?.data] as const),
  );
  const codeById = new Map(locations.map((l) => [l.id, l.code]));

  function binOptions(line: Line) {
    const opts = new Map<string, string>();
    const stock = stockBySku.get(line.skuId);
    if (stock?.ok) {
      for (const r of stock.rows) {
        if (r.qty > 0) opts.set(r.locationId, r.locationCode);
      }
      if (opts.size === 0) {
        for (const l of locations) if (l.active) opts.set(l.id, l.code);
      }
    }
    if (line.locationId) {
      opts.set(
        line.locationId,
        codeById.get(line.locationId) ?? line.locationId,
      );
    }
    return [...opts].map(([value, label]) => ({ value, label }));
  }

  function edit(next: Request[]) {
    setRequests(next);
    // Any edit makes the earlier suggestion stale.
    setSuggestion(null);
    setBins([]);
    setError(null);
  }

  async function suggest() {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await suggestPickList({
        data: {
          warehouseId,
          requests: requests.map((r) => ({
            skuId: r.skuId.trim(),
            qty: r.qty as number,
          })),
        },
      });
      if (res.ok) {
        setSuggestion({ lines: res.lines, shortfalls: res.shortfalls });
        setBins(res.lines.map((l) => l.locationId));
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

  const allBinned =
    suggestion !== null &&
    suggestion.lines.length > 0 &&
    bins.length === suggestion.lines.length &&
    bins.every((b) => b !== null);

  async function create() {
    if (!suggestion || !allBinned || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await createPickList({
        data: {
          warehouseId,
          lines: suggestion.lines.map((l, i) => ({
            skuId: l.skuId,
            locationId: bins[i] as string,
            qty: l.qty,
          })),
          ...(assignee ? { assignedUserId: assignee } : {}),
        },
      });
      if (res.ok) {
        await qc.invalidateQueries({
          queryKey: ['desk', warehouseId, 'pick-lists'],
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
      <Text fw={600}>Requested</Text>
      {requests.map((r, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and have no id
        <Group key={i} align="flex-end" wrap="nowrap">
          <TextInput
            label="SKU"
            aria-label={`SKU ${i + 1}`}
            value={r.skuId}
            disabled={pending}
            onChange={(e) =>
              edit(
                requests.map((x, j) =>
                  j === i ? { ...x, skuId: e.currentTarget.value } : x,
                ),
              )
            }
          />
          <NumberInput
            label="Qty"
            aria-label={`Qty ${i + 1}`}
            allowDecimal={false}
            min={1}
            w={100}
            value={r.qty}
            disabled={pending}
            onChange={(v) =>
              edit(requests.map((x, j) => (j === i ? { ...x, qty: v } : x)))
            }
          />
          <ActionIcon
            variant="subtle"
            color="red"
            aria-label={`Remove request ${i + 1}`}
            disabled={pending || requests.length === 1}
            onClick={() => edit(requests.filter((_, j) => j !== i))}
          >
            ×
          </ActionIcon>
        </Group>
      ))}
      <Group>
        <Button
          variant="subtle"
          size="xs"
          disabled={pending}
          onClick={() => edit([...requests, { skuId: '', qty: '' }])}
        >
          Add SKU
        </Button>
        <Button
          onClick={() => void suggest()}
          disabled={pending || !validRequests}
        >
          Suggest bins
        </Button>
      </Group>

      {suggestion && (
        <Stack gap="xs">
          <Text fw={600}>Suggested lines</Text>
          {suggestion.shortfalls.map((s) => (
            <Alert key={s.skuId} color="yellow">
              {`Short by ${s.missing} for ${s.skuId}`}
            </Alert>
          ))}
          {suggestion.lines.map((l, i) => (
            <Group
              // biome-ignore lint/suspicious/noArrayIndexKey: lines are positional
              key={i}
              align="flex-end"
              wrap="nowrap"
            >
              <Text w={140} truncate>
                {l.skuId}
              </Text>
              <Text w={50} ta="right">
                {l.qty}
              </Text>
              <Select
                aria-label={`Bin for line ${i + 1}`}
                placeholder="Choose a bin"
                searchable
                data={binOptions(l)}
                value={bins[i] ?? null}
                disabled={pending}
                error={bins[i] ? undefined : 'Choose a bin'}
                onChange={(v) =>
                  setBins((prev) => prev.map((b, j) => (j === i ? v : b)))
                }
              />
            </Group>
          ))}
          <Select
            label="Assign to (optional)"
            clearable
            data={workers.map((w) => ({ value: w.id, label: w.name }))}
            value={assignee}
            disabled={pending}
            onChange={setAssignee}
          />
        </Stack>
      )}

      {error && <DeskErrorAlert error={error} />}
      {suggestion && (
        <Button
          onClick={() => void create()}
          disabled={pending || !allBinned}
          loading={pending}
        >
          Create pick list
        </Button>
      )}
    </Stack>
  );
}
