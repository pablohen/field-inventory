import { Badge, Table, Text } from '@mantine/core';
import type { LedgerRow } from '#/server/desk/stock.server';
import { fmtTime } from './Timeline';

function signed(n: number): string {
  return n < 0 ? `−${Math.abs(n)}` : n > 0 ? `+${n}` : '0';
}

export function LedgerTable({
  rows,
  names,
}: {
  rows: LedgerRow[];
  names: Record<string, string>;
}) {
  if (rows.length === 0) return <Text c="dimmed">No movements.</Text>;
  return (
    <Table.ScrollContainer minWidth={760}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Seq</Table.Th>
            <Table.Th>Occurred at</Table.Th>
            <Table.Th>Received at</Table.Th>
            <Table.Th>Type</Table.Th>
            <Table.Th ta="right">Delta</Table.Th>
            <Table.Th ta="right">Balance</Table.Th>
            <Table.Th>User</Table.Th>
            <Table.Th>Device</Table.Th>
            <Table.Th>Source</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={r.id}>
              <Table.Td>{r.seq}</Table.Td>
              <Table.Td>{fmtTime(r.occurredAt)}</Table.Td>
              <Table.Td>{fmtTime(r.receivedAt)}</Table.Td>
              <Table.Td>{r.type}</Table.Td>
              <Table.Td
                ta="right"
                c={r.delta < 0 ? 'red' : undefined}
                data-testid="ledger-delta"
              >
                {signed(r.delta)}
              </Table.Td>
              <Table.Td
                ta="right"
                c={r.runningBalance < 0 ? 'red' : undefined}
                data-testid="ledger-balance"
              >
                {r.runningBalance}
              </Table.Td>
              <Table.Td>{names[r.userId] ?? r.userId}</Table.Td>
              <Table.Td>{r.deviceId}</Table.Td>
              <Table.Td>
                {r.source === 'device' ? (
                  r.source
                ) : (
                  <Badge variant="light" color="grape">
                    {r.source}
                  </Badge>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
