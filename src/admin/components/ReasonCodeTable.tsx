import {
  Badge,
  Button,
  Group,
  MultiSelect,
  Table,
  Text,
  TextInput,
} from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import {
  MOVEMENT_TYPES,
  type ReasonCodeInput,
  reasonCodeInputSchema,
  updateReasonCodeInputSchema,
} from '#/admin/catalog-input';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { deskCall } from '#/desk/desk-call';
import { createReasonCode, updateReasonCode } from '#/server/admin/catalog.fn';
import type { ReasonCodeRow } from '#/server/admin/catalog.server';
import type { DeskError } from '#/server/desk/warehouses.server';

type Err = Pick<DeskError, 'code' | 'message'>;

function useReasonSave(
  run: (data: ReasonCodeInput) => Promise<{ ok: true } | DeskError>,
) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<Err | null>(null);
  async function save(data: ReasonCodeInput, onOk?: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await run(data);
      await qc.invalidateQueries({ queryKey: ['admin', 'reason-codes'] });
      if (res.ok) onOk?.();
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
  }
  return { save, pending, error };
}

export function ReasonCodeTable({ rows }: { rows: ReasonCodeRow[] }) {
  return (
    <Table.ScrollContainer minWidth={640}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Code</Table.Th>
            <Table.Th>Label</Table.Th>
            <Table.Th>Applies to</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <NewReasonRow />
          {rows.map((r) => (
            <ReasonRowView key={r.code} row={r} />
          ))}
          {rows.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={4}>
                <Text c="dimmed">No reason codes.</Text>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function ReasonRowView({ row }: { row: ReasonCodeRow }) {
  const [label, setLabel] = useState(row.label);
  const [appliesTo, setAppliesTo] = useState<string[]>(row.appliesTo);
  const { save, pending, error } = useReasonSave((data) =>
    deskCall(updateReasonCode, data),
  );
  const parsed = updateReasonCodeInputSchema.safeParse({
    code: row.code,
    label,
    appliesTo,
  });
  const dirty =
    label !== row.label || appliesTo.join(',') !== row.appliesTo.join(',');
  const locked = row.system || pending;
  return (
    <>
      <Table.Tr>
        <Table.Td>
          <Group gap="xs">
            {row.code}
            {row.system && (
              <Badge color="gray" size="xs">
                System
              </Badge>
            )}
            {row.malformed && (
              <Badge color="red" size="xs">
                Malformed
              </Badge>
            )}
          </Group>
        </Table.Td>
        <Table.Td>
          <TextInput
            aria-label={`Label ${row.code}`}
            value={label}
            disabled={locked}
            onChange={(e) => setLabel(e.currentTarget.value)}
          />
        </Table.Td>
        <Table.Td>
          <MultiSelect
            aria-label={`Applies to ${row.code}`}
            data={[...MOVEMENT_TYPES]}
            value={appliesTo}
            disabled={locked}
            onChange={setAppliesTo}
          />
        </Table.Td>
        <Table.Td>
          <Button
            size="xs"
            aria-label={`Save ${row.code}`}
            disabled={locked || !dirty || !parsed.success}
            loading={pending}
            onClick={() => parsed.success && void save(parsed.data)}
          >
            Save
          </Button>
        </Table.Td>
      </Table.Tr>
      {error && (
        <Table.Tr>
          <Table.Td colSpan={4}>
            <DeskErrorAlert error={error} />
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}

function NewReasonRow() {
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [appliesTo, setAppliesTo] = useState<string[]>([]);
  const { save, pending, error } = useReasonSave((data) =>
    deskCall(createReasonCode, data),
  );
  const parsed = reasonCodeInputSchema.safeParse({ code, label, appliesTo });
  return (
    <>
      <Table.Tr>
        <Table.Td>
          <TextInput
            aria-label="New reason code"
            placeholder="NEW_CODE"
            value={code}
            disabled={pending}
            onChange={(e) => setCode(e.currentTarget.value)}
          />
        </Table.Td>
        <Table.Td>
          <TextInput
            aria-label="New reason label"
            value={label}
            disabled={pending}
            onChange={(e) => setLabel(e.currentTarget.value)}
          />
        </Table.Td>
        <Table.Td>
          <MultiSelect
            aria-label="New reason applies to"
            data={[...MOVEMENT_TYPES]}
            value={appliesTo}
            disabled={pending}
            onChange={setAppliesTo}
          />
        </Table.Td>
        <Table.Td>
          <Button
            size="xs"
            disabled={pending || !parsed.success}
            loading={pending}
            onClick={() =>
              parsed.success &&
              void save(parsed.data, () => {
                setCode('');
                setLabel('');
                setAppliesTo([]);
              })
            }
          >
            Add reason code
          </Button>
        </Table.Td>
      </Table.Tr>
      {error && (
        <Table.Tr>
          <Table.Td colSpan={4}>
            <DeskErrorAlert error={error} />
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}
