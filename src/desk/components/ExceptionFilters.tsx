import {
  Badge,
  Group,
  NumberInput,
  Select,
  Stack,
  TextInput,
} from '@mantine/core';
import { useEffect, useState } from 'react';
import {
  EXCEPTION_TYPES,
  type ExceptionFilters as Filters,
} from '#/desk/exception-filters';
import type { ExceptionType } from '#/domain/types';

/** One badge per type with its open count; the active one clears on click. */
export function TypeStrip({
  counts,
  active,
  onSelect,
}: {
  counts: Record<ExceptionType, number> | undefined;
  active: ExceptionType | undefined;
  onSelect: (type: ExceptionType | undefined) => void;
}) {
  return (
    <Group gap="xs">
      {EXCEPTION_TYPES.map((t) => (
        <Badge
          key={t}
          component="button"
          type="button"
          size="lg"
          variant={active === t ? 'filled' : 'light'}
          style={{ cursor: 'pointer' }}
          aria-pressed={active === t}
          onClick={() => onSelect(active === t ? undefined : t)}
        >
          {t} {counts ? counts[t] : '…'}
        </Badge>
      ))}
    </Group>
  );
}

export function TextFilter({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: string | undefined;
  onCommit: (v: string | undefined) => void;
}) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => setDraft(value ?? ''), [value]);
  const commit = () => onCommit(draft.trim() === '' ? undefined : draft.trim());
  return (
    <TextInput
      label={label}
      w={160}
      value={draft}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit();
      }}
    />
  );
}

export function ExceptionFilterBar({
  value,
  workers,
  onChange,
}: {
  value: Filters;
  workers: { id: string; name: string }[];
  onChange: (next: Filters) => void;
}) {
  return (
    <Stack gap="sm">
      <Group align="flex-end" gap="sm">
        <Select
          label="Type"
          w={200}
          clearable
          data={EXCEPTION_TYPES.map((t) => ({ value: t, label: t }))}
          value={value.type ?? null}
          onChange={(type) =>
            onChange({
              ...value,
              type: (type as ExceptionType | null) ?? undefined,
            })
          }
        />
        <TextFilter
          label="SKU"
          value={value.skuId}
          onCommit={(skuId) => onChange({ ...value, skuId })}
        />
        <TextFilter
          label="Bin"
          value={value.locationId}
          onCommit={(locationId) => onChange({ ...value, locationId })}
        />
        <Select
          label="Worker"
          w={180}
          clearable
          data={workers.map((w) => ({ value: w.id, label: w.name }))}
          value={value.userId ?? null}
          onChange={(userId) =>
            onChange({ ...value, userId: userId ?? undefined })
          }
        />
        <NumberInput
          label="Min age (hours)"
          w={140}
          min={0}
          value={value.minAgeHours ?? ''}
          onChange={(v) =>
            onChange({
              ...value,
              minAgeHours: typeof v === 'number' ? v : undefined,
            })
          }
        />
      </Group>
    </Stack>
  );
}
