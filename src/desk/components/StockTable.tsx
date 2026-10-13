import { Checkbox, Group, Table } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import type { StockFilters } from '#/desk/stock-filters';
import type { StockRow } from '#/server/desk/stock.server';
import { EmptyNote } from '#/ui/EmptyNote';
import { TextFilter } from './ExceptionFilters';
import { ProductPicker } from './ProductPicker';

export function StockFilterBar({
  value,
  onChange,
}: {
  value: StockFilters;
  onChange: (next: StockFilters) => void;
}) {
  return (
    <Group align="flex-end" gap="sm">
      <ProductPicker
        label="SKU"
        w={220}
        value={value.skuId ?? null}
        onChange={(skuId) => onChange({ ...value, skuId: skuId ?? undefined })}
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
  if (rows.length === 0) return <EmptyNote>No stock matches.</EmptyNote>;
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
              <Table.Td fw={800}>{r.locationCode}</Table.Td>
              <Table.Td
                ta="right"
                className="fi-num"
                data-negative={r.qty < 0 ? 'true' : undefined}
                style={r.qty < 0 ? { color: 'var(--fi-danger)' } : undefined}
                fw={800}
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
