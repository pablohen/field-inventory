import { Loader, Stack, Title } from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import { asList } from '#/desk/as-list';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import {
  ExceptionFilterBar,
  TypeStrip,
} from '#/desk/components/ExceptionFilters';
import { ExceptionTable } from '#/desk/components/ExceptionTable';
import { errorMessage, RefreshNote } from '#/desk/components/RefreshNote';
import { deskCall } from '#/desk/desk-call';
import {
  type ExceptionFilters,
  parseExceptionSearch,
} from '#/desk/exception-filters';
import { listWorkers } from '#/server/desk/count-tasks.fn';
import { listExceptions } from '#/server/desk/exceptions.fn';
import { inCollapsedRail } from '#/ui/AppShellSidebar';
import { OnboardingTour } from '#/ui/OnboardingTour';
import { DESK_TOUR, isShown, TOUR_KEYS } from '#/ui/onboarding';

/** Desk steps skip the sidebar while it is a shut drawer on narrow screens. */
const deskStepShown = (el: Element) => isShown(el) && !inCollapsedRail(el);

export const Route = createFileRoute('/w/$warehouseId/exceptions/')({
  validateSearch: parseExceptionSearch,
  component: ExceptionsRoute,
});

function ExceptionsRoute() {
  const { warehouseId } = Route.useParams();
  return <ExceptionsListPage warehouseId={warehouseId} />;
}

export function ExceptionsListPage({ warehouseId }: { warehouseId: string }) {
  // strict:false may expose the raw URL search, so re-validate defensively.
  const filters = parseExceptionSearch(useSearch({ strict: false }));
  const navigate = useNavigate();
  const setSearch = (patch: (prev: ExceptionFilters) => ExceptionFilters) =>
    void navigate({
      to: '.',
      search: ((prev: ExceptionFilters) => patch(prev)) as never,
    });

  const list = useQuery({
    queryKey: ['desk', warehouseId, 'exceptions', filters],
    queryFn: () => deskCall(listExceptions, { warehouseId, filters }),
    placeholderData: keepPreviousData,
  });
  const workers = useQuery({
    queryKey: ['desk', 'workers'],
    queryFn: () => deskCall(listWorkers),
    refetchInterval: false,
  });
  const workerList = asList<{ id: string; name: string }>(workers.data);
  const names = Object.fromEntries(workerList.map((w) => [w.id, w.name]));
  const data = list.data;

  return (
    <Stack>
      <Title order={3}>Exceptions</Title>
      <div data-tour="exception-tiles">
        <TypeStrip
          counts={data?.ok ? data.countsByType : undefined}
          active={filters.type}
          onSelect={(type) => setSearch((prev) => ({ ...prev, type }))}
        />
      </div>
      <ExceptionFilterBar
        value={filters}
        workers={workerList}
        onChange={(next) => setSearch(() => next)}
      />
      {list.isError && data && <RefreshNote />}
      {!data ? (
        list.isError ? (
          <DeskErrorAlert
            error={{ code: 'INVALID', message: errorMessage(list.error) }}
          />
        ) : (
          <Loader size="sm" />
        )
      ) : data.ok ? (
        <div data-tour="exception-list">
          <ExceptionTable
            warehouseId={warehouseId}
            rows={data.rows}
            names={names}
          />
        </div>
      ) : (
        <DeskErrorAlert error={data} onReload={() => void list.refetch()} />
      )}
      <OnboardingTour
        storageKey={TOUR_KEYS.desk}
        steps={DESK_TOUR}
        autoStart={data?.ok === true}
        isShown={deskStepShown}
      />
    </Stack>
  );
}
