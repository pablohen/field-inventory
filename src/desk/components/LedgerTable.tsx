import { Table } from '@mantine/core';
import type { LedgerRow } from '#/server/desk/stock.server';
import { EmptyNote } from '#/ui/EmptyNote';
import { StatusBadge } from '#/ui/StatusBadge';
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
  if (rows.length === 0) return <EmptyNote>No movements.</EmptyNote>;
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
                className="fi-num"
                fw={800}
                style={r.delta < 0 ? { color: 'var(--fi-danger)' } : undefined}
                data-testid="ledger-delta"
              >
                {signed(r.delta)}
              </Table.Td>
              <Table.Td
                ta="right"
                className="fi-num"
                fw={800}
                style={
                  r.runningBalance < 0
                    ? { color: 'var(--fi-danger)' }
                    : undefined
                }
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
                  <StatusBadge kind="pending">{r.source}</StatusBadge>
                )}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
