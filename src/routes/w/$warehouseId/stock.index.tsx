import { Loader, Stack, Title } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { errorMessage, RefreshNote } from '#/desk/components/RefreshNote';
import { StockFilterBar, StockTable } from '#/desk/components/StockTable';
import { deskCall } from '#/desk/desk-call';
import { parseStockSearch } from '#/desk/stock-filters';
import { getStock } from '#/server/desk/stock.fn';

export const Route = createFileRoute('/w/$warehouseId/stock/')({
  validateSearch: parseStockSearch,
  component: StockRoute,
});

function StockRoute() {
  const { warehouseId } = Route.useParams();
  return <StockPage warehouseId={warehouseId} />;
}

export function StockPage({ warehouseId }: { warehouseId: string }) {
  // strict:false may expose the raw URL search, so re-validate defensively.
  const filters = parseStockSearch(useSearch({ strict: false }));
  const navigate = useNavigate();
  const stock = useQuery({
    queryKey: ['desk', warehouseId, 'stock', filters],
    queryFn: () => deskCall(getStock, { warehouseId, filters }),
    placeholderData: keepPreviousData,
  });
  const data = stock.data;

  return (
    <Stack>
      <Title order={3}>Stock</Title>
      <StockFilterBar
        value={filters}
        onChange={(next) =>
          void navigate({ to: '.', search: (() => next) as never })
        }
      />
      {stock.isError && data && <RefreshNote />}
      {!data ? (
        stock.isError ? (
          <DeskErrorAlert
            error={{ code: 'INVALID', message: errorMessage(stock.error) }}
          />
        ) : (
          <Loader size="sm" />
        )
      ) : data.ok ? (
        <StockTable warehouseId={warehouseId} rows={data.rows} />
      ) : (
        <DeskErrorAlert error={data} onReload={() => void stock.refetch()} />
      )}
    </Stack>
  );
}
