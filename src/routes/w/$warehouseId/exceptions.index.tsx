import { Loader, Stack, Title } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import {
  ExceptionFilterBar,
  TypeStrip,
} from '#/desk/components/ExceptionFilters';
import { ExceptionTable } from '#/desk/components/ExceptionTable';
import {
  type ExceptionFilters,
  exceptionFiltersSchema,
} from '#/desk/exception-filters';
import { listWorkers } from '#/server/desk/count-tasks.fn';
import { listExceptions } from '#/server/desk/exceptions.fn';

export const Route = createFileRoute('/w/$warehouseId/exceptions/')({
  validateSearch: (search) => exceptionFiltersSchema.parse(search),
  component: ExceptionsRoute,
});

function ExceptionsRoute() {
  const { warehouseId } = Route.useParams();
  return <ExceptionsListPage warehouseId={warehouseId} />;
}

export function ExceptionsListPage({ warehouseId }: { warehouseId: string }) {
  const filters = useSearch({ strict: false }) as ExceptionFilters;
  const navigate = useNavigate();
  const setSearch = (patch: (prev: ExceptionFilters) => ExceptionFilters) =>
    void navigate({
      to: '.',
      search: ((prev: ExceptionFilters) => patch(prev)) as never,
    });

  const list = useQuery({
    queryKey: ['desk', warehouseId, 'exceptions', filters],
    queryFn: () => listExceptions({ data: { warehouseId, filters } }),
    placeholderData: keepPreviousData,
  });
  const workers = useQuery({
    queryKey: ['desk', 'workers'],
    queryFn: () => listWorkers(),
    refetchInterval: false,
  });
  const workerList = workers.data ?? [];
  const names = Object.fromEntries(workerList.map((w) => [w.id, w.name]));
  const data = list.data;

  return (
    <Stack>
      <Title order={3}>Exceptions</Title>
      <TypeStrip
        counts={data?.ok ? data.countsByType : undefined}
        active={filters.type}
        onSelect={(type) => setSearch((prev) => ({ ...prev, type }))}
      />
      <ExceptionFilterBar
        value={filters}
        workers={workerList}
        onChange={(next) => setSearch(() => next)}
      />
      {list.isError ? (
        <DeskErrorAlert
          error={{
            code: 'INVALID',
            message:
              list.error instanceof Error
                ? list.error.message
                : 'Request failed',
          }}
        />
      ) : !data ? (
        <Loader size="sm" />
      ) : data.ok ? (
        <ExceptionTable
          warehouseId={warehouseId}
          rows={data.rows}
          names={names}
        />
      ) : (
        <DeskErrorAlert error={data} onReload={() => void list.refetch()} />
      )}
    </Stack>
  );
}
