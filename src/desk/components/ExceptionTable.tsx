import { Group, Table } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { ExceptionRow } from '#/server/desk/exceptions.server';
import { EmptyNote } from '#/ui/EmptyNote';
import { StatusBadge } from '#/ui/StatusBadge';

export function ExceptionTable({
  warehouseId,
  rows,
  names,
}: {
  warehouseId: string;
  rows: ExceptionRow[];
  names: Record<string, string>;
}) {
  if (rows.length === 0) {
    return <EmptyNote>No open exceptions. Floor's clear.</EmptyNote>;
  }
  return (
    <Table.ScrollContainer minWidth={640}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Type</Table.Th>
            <Table.Th>Summary</Table.Th>
            <Table.Th>SKU</Table.Th>
            <Table.Th>Bin</Table.Th>
            <Table.Th>Workers</Table.Th>
            <Table.Th>Age</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>
                <StatusBadge kind={r.type}>{r.type}</StatusBadge>
              </Table.Td>
              <Table.Td>
                <Group gap="xs" wrap="nowrap">
                  <Link
                    to="/w/$warehouseId/exceptions/$id"
                    params={{ warehouseId, id: r.id }}
                  >
                    {r.summary}
                  </Link>
                  {r.malformed.length > 0 && (
                    <StatusBadge size="xs" kind="attention">
                      data issue
                    </StatusBadge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>{r.skuId ?? '—'}</Table.Td>
              <Table.Td>{r.locationId ?? '—'}</Table.Td>
              <Table.Td>
                {r.userIds.map((u) => names[u] ?? u).join(', ') || '—'}
              </Table.Td>
              <Table.Td>{r.ageHours} h</Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
