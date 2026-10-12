import { Checkbox, Group, Table, Text } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { StockFilters } from '#/desk/stock-filters';
import type { StockRow } from '#/server/desk/stock.server';
import { TextFilter } from './ExceptionFilters';

export function StockFilterBar({
  value,
  onChange,
}: {
  value: StockFilters;
  onChange: (next: StockFilters) => void;
}) {
  return (
    <Group align="flex-end" gap="sm">
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
      <Checkbox
        label="Non-zero only"
        checked={value.nonZero === true}
        onChange={(e) =>
          onChange({
            ...value,
            nonZero: e.currentTarget.checked ? true : undefined,
          })
        }
      />
    </Group>
  );
}

export function StockTable({
  warehouseId,
  rows,
}: {
  warehouseId: string;
  rows: StockRow[];
}) {
  if (rows.length === 0) return <Text c="dimmed">No stock matches.</Text>;
  return (
    <Table.ScrollContainer minWidth={480}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>SKU</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Bin</Table.Th>
            <Table.Th ta="right">Qty</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <Table.Tr key={`${r.skuId}:${r.locationId}`}>
              <Table.Td>
                <Link
                  to="/w/$warehouseId/stock/ledger"
                  params={{ warehouseId }}
                  search={{ skuId: r.skuId, locationId: r.locationId }}
                >
                  {r.sku}
                </Link>
              </Table.Td>
              <Table.Td>{r.name}</Table.Td>
              <Table.Td>{r.locationCode}</Table.Td>
              <Table.Td
                ta="right"
                data-negative={r.qty < 0 ? 'true' : undefined}
                c={r.qty < 0 ? 'red' : undefined}
                fw={r.qty < 0 ? 600 : undefined}
              >
                {r.qty}
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
