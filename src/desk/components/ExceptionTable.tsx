import { Badge, Group, Table, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { ExceptionRow } from '#/server/desk/exceptions.server';

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
    return <Text c="dimmed">No open exceptions match.</Text>;
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
                <Badge variant="light">{r.type}</Badge>
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
                    <Badge size="xs" color="red" variant="outline">
                      data issue
                    </Badge>
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
