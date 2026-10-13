import { Badge, Button, Group, Select, Table, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { scopeSummary } from '#/desk/count-scope';
import { deskCall } from '#/desk/desk-call';
import { runMutation } from '#/desk/run-mutation';
import { assignCountTask, closeCountTask } from '#/server/desk/count-tasks.fn';
import type { CountTaskRow } from '#/server/desk/count-tasks.server';
import type { DeskError } from '#/server/desk/warehouses.server';
import { DeskErrorAlert } from './DeskErrorAlert';

type Worker = { id: string; name: string };

export function CountTaskTable({
  warehouseId,
  rows,
  workers,
}: {
  warehouseId: string;
  rows: CountTaskRow[];
  workers: Worker[];
}) {
  if (rows.length === 0) return <Text c="dimmed">No count tasks.</Text>;
  return (
    <Table.ScrollContainer minWidth={640}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Task</Table.Th>
            <Table.Th>Scope</Table.Th>
            <Table.Th>Assignee</Table.Th>
            <Table.Th ta="right">Counts</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <CountTaskRowView
              key={r.id}
              warehouseId={warehouseId}
              row={r}
              workers={workers}
            />
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function CountTaskRowView({
  warehouseId,
  row,
  workers,
}: {
  warehouseId: string;
  row: CountTaskRow;
  workers: Worker[];
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<Pick<
    DeskError,
    'code' | 'message'
  > | null>(null);
  const done = row.status === 'DONE';

  async function run(
    fn: () => Promise<{ ok: true } | DeskError>,
  ): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await runMutation(fn, setError);
      if (res === undefined) return;
      if (res.ok) {
        await qc.invalidateQueries({
          queryKey: ['desk', warehouseId, 'counts'],
        });
      } else {
        setError(res);
      }
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  const options = workers.map((w) => ({ value: w.id, label: w.name }));
  if (
    row.assignedUserId &&
    !options.some((o) => o.value === row.assignedUserId)
  ) {
    options.push({
      value: row.assignedUserId,
      label: row.assignedUserName ?? row.assignedUserId,
    });
  }

  return (
    <>
      <Table.Tr>
        <Table.Td>{row.id.slice(0, 8)}</Table.Td>
        <Table.Td>{scopeSummary(row.scope, row.malformed)}</Table.Td>
        <Table.Td>
          <Select
            aria-label={`Assignee for ${row.id}`}
            placeholder="Unassigned"
            size="xs"
            clearable
            data={options}
            value={row.assignedUserId}
            disabled={pending || done}
            onChange={(v) =>
              void run(() =>
                deskCall(assignCountTask, {
                  warehouseId,
                  taskId: row.id,
                  assignedUserId: v,
                }),
              )
            }
          />
        </Table.Td>
        <Table.Td ta="right">{row.countsRecorded}</Table.Td>
        <Table.Td>
          <Badge color={done ? 'gray' : 'blue'} variant="light">
            {done ? 'Done' : 'Open'}
          </Badge>
        </Table.Td>
        <Table.Td>
          <Group gap="xs">
            {!done && (
              <Button
                size="xs"
                variant="light"
                disabled={pending}
                loading={pending}
                onClick={() =>
                  void run(() =>
                    deskCall(closeCountTask, { warehouseId, taskId: row.id }),
                  )
                }
              >
                Close
              </Button>
            )}
          </Group>
        </Table.Td>
      </Table.Tr>
      {error && (
        <Table.Tr>
          <Table.Td colSpan={6}>
            <DeskErrorAlert error={error} />
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}
