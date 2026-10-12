import { Alert, Group, Loader, Stack, Text, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Link, useSearch } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { asList } from '#/desk/as-list';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { LedgerTable } from '#/desk/components/LedgerTable';
import { errorMessage, RefreshNote } from '#/desk/components/RefreshNote';
import { deskCall } from '#/desk/desk-call';
import {
  type LedgerKey,
  ledgerKeySchema,
  parseLedgerSearch,
} from '#/desk/stock-filters';
import { listWorkers } from '#/server/desk/count-tasks.fn';
import { getLedger } from '#/server/desk/stock.fn';

export const Route = createFileRoute('/w/$warehouseId/stock/ledger')({
  validateSearch: parseLedgerSearch,
  component: LedgerRoute,
});

function LedgerRoute() {
  const { warehouseId } = Route.useParams();
  return <LedgerPage warehouseId={warehouseId} />;
}

export function LedgerPage({ warehouseId }: { warehouseId: string }) {
  const search = useSearch({ strict: false });
  const parsed = ledgerKeySchema.safeParse(search);
  const back = (
    <Link to="/w/$warehouseId/stock" params={{ warehouseId }}>
      ← Stock
    </Link>
  );
  if (!parsed.success) {
    return (
      <Stack>
        {back}
        <Alert color="blue">Pick a stock row to see its ledger.</Alert>
      </Stack>
    );
  }
  return (
    <LedgerContent warehouseId={warehouseId} keyOf={parsed.data} back={back} />
  );
}

function LedgerContent({
  warehouseId,
  keyOf,
  back,
}: {
  warehouseId: string;
  keyOf: LedgerKey;
  back: ReactNode;
}) {
  const ledger = useQuery({
    queryKey: ['desk', warehouseId, 'ledger', keyOf],
    queryFn: () => deskCall(getLedger, { warehouseId, key: keyOf }),
  });
  const workers = useQuery({
    queryKey: ['desk', 'workers'],
    queryFn: () => deskCall(listWorkers),
    refetchInterval: false,
  });
  const names = Object.fromEntries(
    asList<{ id: string; name: string }>(workers.data).map((w) => [
      w.id,
      w.name,
    ]),
  );
  const data = ledger.data;

  return (
    <Stack>
      {back}
      <Title order={3}>Ledger</Title>
      <Text size="sm" c="dimmed">
        SKU {keyOf.skuId} · Bin {keyOf.locationId}
      </Text>
      {ledger.isError && data && <RefreshNote />}
      {!data ? (
        ledger.isError ? (
          <DeskErrorAlert
            error={{ code: 'INVALID', message: errorMessage(ledger.error) }}
          />
        ) : (
          <Loader size="sm" />
        )
      ) : data.ok ? (
        <>
          <Group gap="xs">
            <Text fw={600}>Current balance:</Text>
            <Text
              fw={600}
              c={data.balance < 0 ? 'red' : undefined}
              data-testid="ledger-header-balance"
            >
              {data.balance}
            </Text>
          </Group>
          <LedgerTable rows={data.rows} names={names} />
        </>
      ) : (
        <DeskErrorAlert error={data} onReload={() => void ledger.refetch()} />
      )}
    </Stack>
  );
}
