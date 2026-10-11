import { Alert, Badge, Button, Group, Stack, Table, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { useHandheld } from '../context';
import { type StockFilter, stockKey } from '../record';
import { ScanInput } from './ScanInput';

export function StockView({ wh }: { wh: string }) {
  const { backend } = useHandheld();
  const [filter, setFilter] = useState<StockFilter | undefined>();
  const [label, setLabel] = useState('');
  const [notFound, setNotFound] = useState('');

  const { data, error, isLoading } = useQuery({
    queryKey: stockKey(wh, filter),
    queryFn: () =>
      (backend as NonNullable<typeof backend>).call(
        'displayedStock',
        wh,
        filter,
      ),
    enabled: backend !== null,
  });

  const onScan = async (scan: string) => {
    if (!backend) return;
    setNotFound('');
    try {
      const product = await backend.call('findProduct', scan);
      if (product) {
        setFilter({ skuId: product.id });
        setLabel(`${product.sku} ${product.name}`);
        return;
      }
      const loc = await backend.call('findLocation', wh, scan);
      if (loc) {
        setFilter({ locationId: loc.id });
        setLabel(`Location ${loc.code}`);
        return;
      }
      setNotFound(scan);
    } catch (err) {
      console.error('Scan lookup failed', err);
      setNotFound(scan);
    }
  };

  return (
    <Stack>
      <ScanInput label="Filter by product or location" onScan={onScan} />
      {notFound && (
        <Alert color="yellow">No product or location matches {notFound}</Alert>
      )}
      {filter && (
        <Group gap="xs">
          <Badge variant="outline">{label}</Badge>
          <Button
            size="compact-xs"
            variant="subtle"
            onClick={() => {
              setFilter(undefined);
              setLabel('');
            }}
          >
            Clear filter
          </Button>
        </Group>
      )}
      {error && <Alert color="red">Could not load stock</Alert>}
      {isLoading || backend === null ? (
        <Text c="dimmed">Loading…</Text>
      ) : (
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>SKU</Table.Th>
              <Table.Th>Location</Table.Th>
              <Table.Th ta="right">Qty</Table.Th>
              <Table.Th />
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {(data ?? []).map((r) => (
              <Table.Tr key={`${r.skuId}|${r.locationId}`}>
                <Table.Td>{r.skuId}</Table.Td>
                <Table.Td>{r.locationId}</Table.Td>
                <Table.Td ta="right">{r.qty}</Table.Td>
                <Table.Td>
                  {r.pendingDelta !== 0 && (
                    <Badge color="blue" variant="light">
                      Pending
                    </Badge>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
            {data?.length === 0 && (
              <Table.Tr>
                <Table.Td colSpan={4}>
                  <Text c="dimmed">No stock</Text>
                </Table.Td>
              </Table.Tr>
            )}
          </Table.Tbody>
        </Table>
      )}
    </Stack>
  );
}
