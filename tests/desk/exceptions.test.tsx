// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseExceptionSearch } from '#/desk/exception-filters';
import type {
  ExceptionRow,
  TimelineMovement,
} from '#/server/desk/exceptions.server';

import { deskFetch } from '#/shared/checked-fetch';

const listExceptions = vi.hoisted(() => vi.fn());
const getExceptionDetail = vi.hoisted(() => vi.fn());
vi.mock('#/server/desk/exceptions.fn', () => ({
  listExceptions,
  getExceptionDetail,
  resolveException: vi.fn(),
}));
vi.mock('#/server/admin/catalog.fn', () => ({
  listProducts: async () => [{ id: 'S1', sku: 'SKU-1', name: 'One' }],
}));
vi.mock('#/server/desk/count-tasks.fn', () => ({
  listWorkers: async () => [{ id: 'w1', name: 'Wendy' }],
}));
vi.mock('#/server/desk/stock.fn', () => ({
  listReasonCodes: async () => [{ code: 'FOUND', label: 'Found' }],
}));

import { type ResolveFn, ResolvePanel } from '#/desk/components/ResolvePanel';
import { Timeline } from '#/desk/components/Timeline';
import { ExceptionDetailPage } from '#/routes/w/$warehouseId/exceptions.$id';
import { ExceptionsListPage } from '#/routes/w/$warehouseId/exceptions.index';

beforeAll(() => {
  window.scrollTo = () => {};
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

const WH = 'wh1';

function mv(
  id: string,
  seq: number,
  type: string,
  occurredAt: string,
  involved: boolean,
): TimelineMovement {
  return {
    id,
    seq,
    type,
    skuId: 'S1',
    fromLocationId: type === 'PICK' ? 'L1' : null,
    toLocationId: type === 'COUNT' ? 'L1' : null,
    qty: 3,
    reasonCode: null,
    userId: 'w1',
    deviceId: 'dev1',
    source: 'device',
    occurredAt,
    receivedAt: '2026-03-01T12:00:00.000Z',
    involved,
  };
}

function wrap(ui: ReactNode, qc = new QueryClient()) {
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );
}

describe('Timeline', () => {
  const pick = mv('pick', 2, 'PICK', '2026-03-01T10:00:00.000Z', false);
  const count = mv('count', 1, 'COUNT', '2026-03-01T11:00:00.000Z', true);

  it('renders both titles, each in its own order, marking involved rows', () => {
    wrap(
      <Timeline
        byOccurredAt={[pick, count]}
        bySeq={[count, pick]}
        keyOf={{ skuId: 'S1', locationId: 'L1' }}
        names={{ w1: 'Wendy' }}
      />,
    );
    expect(screen.getByText('Physical order (occurred at)')).toBeTruthy();
    expect(screen.getByText('Arrival order (seq)')).toBeTruthy();
    const ids = (testid: string) =>
      [
        ...screen
          .getByTestId(testid)
          .querySelectorAll<HTMLElement>('[data-movement-id]'),
      ].map((e) => e.dataset.movementId);
    expect(ids('timeline-occurred')).toEqual(['pick', 'count']);
    expect(ids('timeline-seq')).toEqual(['count', 'pick']);
    const involved = document.querySelectorAll('[data-involved="true"]');
    expect(involved).toHaveLength(2);
    for (const el of involved) {
      expect((el as HTMLElement).dataset.movementId).toBe('count');
    }
    expect(screen.getAllByText(/Wendy/).length).toBeGreaterThan(0);
  });
});

describe('ResolvePanel', () => {
  const panel = (resolve: ResolveFn, qc?: QueryClient) =>
    wrap(
      <ResolvePanel
        warehouseId={WH}
        exceptionId="e1"
        version={4}
        defaults={{ skuId: 'S1', locationId: 'L1' }}
        workers={[{ id: 'w1', name: 'Wendy' }]}
        reasonCodes={[{ code: 'FOUND', label: 'Found' }]}
        resolve={resolve}
      />,
      qc,
    );
  const submit = () => screen.getByRole('button', { name: 'Resolve' });

  it('keeps submit disabled for dismiss with an empty note', () => {
    panel(vi.fn());
    fireEvent.click(screen.getByLabelText('Dismiss'));
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Note/), {
      target: { value: 'duplicate' },
    });
    expect((submit() as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows the conflict message and keeps the form disabled', async () => {
    const resolve = vi.fn(async () => ({
      ok: false as const,
      code: 'CONFLICT' as const,
      message: 'Resolved by someone else',
    }));
    panel(resolve);
    fireEvent.click(submit());
    expect(
      await screen.findByText(
        'Resolved by someone else. Reload to see what changed.',
      ),
    ).toBeTruthy();
    expect(resolve).toHaveBeenCalledWith({
      data: {
        warehouseId: WH,
        exceptionId: 'e1',
        input: { action: 'accept', version: 4, note: undefined },
      },
    });
    expect((submit() as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByLabelText(/Note/) as HTMLTextAreaElement).disabled,
    ).toBe(true);
    expect(screen.getByRole('button', { name: 'Reload' })).toBeTruthy();
  });

  it('invalidates the exceptions key on success', async () => {
    const qc = new QueryClient();
    const spy = vi.spyOn(qc, 'invalidateQueries');
    panel(
      vi.fn(async () => ({ ok: true as const, exceptionId: 'e1', version: 5 })),
      qc,
    );
    fireEvent.click(submit());
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({
        queryKey: ['desk', WH, 'exceptions'],
      }),
    );
    expect(spy).toHaveBeenCalledWith({
      queryKey: ['desk', WH, 'exception', 'e1'],
    });
  });
});

describe('exceptions list page', () => {
  const row = (over: Partial<ExceptionRow>): ExceptionRow => ({
    id: 'e1',
    type: 'COUNT_VARIANCE',
    skuId: 'S1',
    locationId: 'L1',
    deviceId: 'dev1',
    userIds: ['w1'],
    createdAt: '2026-03-01T10:00:00.000Z',
    ageHours: 2,
    version: 0,
    summary: 'observed 3, expected 5 (−2)',
    malformed: [],
    ...over,
  });

  function setup(url = `/w/${WH}/exceptions/`, qc = new QueryClient()) {
    listExceptions.mockResolvedValue({
      ok: true,
      rows: [
        row({}),
        row({
          id: 'e2',
          summary: 'details unreadable',
          malformed: ['details'],
        }),
      ],
      countsByType: {
        NEGATIVE_BALANCE: 0,
        COUNT_VARIANCE: 2,
        LATE_MOVEMENT: 0,
        OVER_PICK: 0,
        TRANSFER_STUCK: 0,
        CLOCK_SKEW: 0,
      },
    });
    const root = createRootRoute();
    const index = createRoute({
      getParentRoute: () => root,
      path: '/w/$warehouseId/exceptions/',
      validateSearch: parseExceptionSearch,
      component: () => <ExceptionsListPage warehouseId={WH} />,
    });
    const detail = createRoute({
      getParentRoute: () => root,
      path: '/w/$warehouseId/exceptions/$id',
    });
    const router = createRouter({
      routeTree: root.addChildren([index, detail]),
      history: createMemoryHistory({
        initialEntries: [url],
      }),
    });
    render(
      <QueryClientProvider client={qc}>
        <MantineProvider>
          <RouterProvider router={router} />
        </MantineProvider>
      </QueryClientProvider>,
    );
    return router;
  }

  it('clicking a type badge sets and clears the type search param', async () => {
    const router = setup();
    const badge = await screen.findByRole('button', {
      name: /COUNT_VARIANCE 2/,
    });
    fireEvent.click(badge);
    await waitFor(() =>
      expect((router.state.location.search as { type?: string }).type).toBe(
        'COUNT_VARIANCE',
      ),
    );
    await waitFor(() =>
      expect(listExceptions).toHaveBeenLastCalledWith({
        fetch: deskFetch,
        data: { warehouseId: WH, filters: { type: 'COUNT_VARIANCE' } },
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: /COUNT_VARIANCE 2/ }));
    await waitFor(() =>
      expect(
        (router.state.location.search as { type?: string }).type,
      ).toBeUndefined(),
    );
  });

  it('links rows to detail and flags malformed rows', async () => {
    setup();
    const link = await screen.findByText('observed 3, expected 5 (−2)');
    expect(link.closest('a')?.getAttribute('href')).toBe(
      `/w/${WH}/exceptions/e1`,
    );
    expect(screen.getAllByText('data issue')).toHaveLength(1);
  });

  it('renders a DeskError result as an alert', async () => {
    listExceptions.mockResolvedValue({
      ok: false,
      code: 'NOT_READY',
      message: 'Warehouse is not ready',
    });
    const root = createRootRoute({
      component: () => <ExceptionsListPage warehouseId={WH} />,
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider>
          <RouterProvider router={router} />
        </MantineProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('Warehouse is not ready')).toBeTruthy();
  });

  it('keeps rows and notes a failed refresh when a poll errors', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    setup(`/w/${WH}/exceptions/`, qc);
    expect(await screen.findByText('observed 3, expected 5 (−2)')).toBeTruthy();
    listExceptions.mockRejectedValue(new Error('network down'));
    await qc.invalidateQueries({ queryKey: ['desk', WH, 'exceptions'] });
    expect(
      await screen.findByText('Refresh failed — showing the last loaded data.'),
    ).toBeTruthy();
    expect(screen.getByText('observed 3, expected 5 (−2)')).toBeTruthy();
    expect(screen.queryByText('network down')).toBeNull();
  });

  it('renders unfiltered on a bad shared URL (?type=BOGUS)', async () => {
    setup(`/w/${WH}/exceptions/?type=BOGUS`);
    expect(await screen.findByText('observed 3, expected 5 (−2)')).toBeTruthy();
    expect(listExceptions).toHaveBeenCalledWith({
      fetch: deskFetch,
      data: { warehouseId: WH, filters: {} },
    });
  });
});

describe('exception detail page', () => {
  it('keeps a typed dismiss note across a failed poll', async () => {
    const ex = {
      id: 'e1',
      type: 'COUNT_VARIANCE',
      status: 'OPEN',
      skuId: 'S1',
      locationId: 'L1',
      deviceId: 'dev1',
      userIds: ['w1'],
      createdAt: '2026-03-01T10:00:00.000Z',
      ageHours: 2,
      version: 0,
      summary: 'observed 3, expected 5 (−2)',
      malformed: [],
      details: {},
      resolution: null,
      note: null,
      resolvedBy: null,
      resolvedAt: null,
    };
    getExceptionDetail.mockResolvedValue({
      ok: true,
      exception: ex,
      byOccurredAt: [],
      bySeq: [],
      missingMovementIds: [],
    });
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const root = createRootRoute({
      component: () => <ExceptionDetailPage warehouseId={WH} id="e1" />,
    });
    const router = createRouter({
      routeTree: root,
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(
      <QueryClientProvider client={qc}>
        <MantineProvider>
          <RouterProvider router={router} />
        </MantineProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByLabelText('Dismiss'));
    fireEvent.change(screen.getByLabelText(/Note/), {
      target: { value: 'duplicate' },
    });
    getExceptionDetail.mockRejectedValue(new Error('network down'));
    await qc.invalidateQueries({ queryKey: ['desk', WH, 'exception', 'e1'] });
    expect(
      await screen.findByText('Refresh failed — showing the last loaded data.'),
    ).toBeTruthy();
    expect((screen.getByLabelText(/Note/) as HTMLTextAreaElement).value).toBe(
      'duplicate',
    );
  });
});
