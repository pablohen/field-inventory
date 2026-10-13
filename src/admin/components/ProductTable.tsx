import { Badge, Button, Group, Table, Text } from '@mantine/core';
import type { ProductRow } from '#/server/admin/catalog.server';

export function toleranceLabel(p: ProductRow): string {
  if (p.countTolerance !== null) return String(p.countTolerance);
  if (p.categoryId && p.categoryName !== null) {
    return `category: ${p.effectiveTolerance}`;
  }
  return '—';
}

export function ProductTable({
  rows,
  onEdit,
}: {
  rows: ProductRow[];
  onEdit: (row: ProductRow) => void;
}) {
  if (rows.length === 0) return <Text c="dimmed">No products.</Text>;
  return (
    <Table.ScrollContainer minWidth={640}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>SKU</Table.Th>
            <Table.Th>Name</Table.Th>
            <Table.Th>Barcodes</Table.Th>
            <Table.Th>Category</Table.Th>
            <Table.Th>Tolerance</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((p) => (
            <Table.Tr key={p.id}>
              <Table.Td>{p.sku}</Table.Td>
              <Table.Td>{p.name}</Table.Td>
              <Table.Td>
                <Group gap={4}>
                  {p.barcodes.join(', ')}
                  {p.malformed && (
                    <Badge color="red" size="xs">
                      Malformed
                    </Badge>
                  )}
                </Group>
              </Table.Td>
              <Table.Td>{p.categoryName ?? '—'}</Table.Td>
              <Table.Td>{toleranceLabel(p)}</Table.Td>
              <Table.Td>
                <Button
                  size="xs"
                  variant="default"
                  aria-label={`Edit ${p.sku}`}
                  onClick={() => onEdit(p)}
                >
                  Edit
                </Button>
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
