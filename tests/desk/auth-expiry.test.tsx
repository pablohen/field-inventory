// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRouteWithContext,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { notifySessionExpired } from '#/desk/auth-error';
import { HttpError } from '#/shared/checked-fetch';

const getWarehouses = vi.hoisted(() => vi.fn());
const listWorkers = vi.hoisted(() => vi.fn());
const listExceptions = vi.hoisted(() => vi.fn());
vi.mock('#/server/desk/desk-auth.fn', () => ({
  getWarehouses,
  getDeskSession: vi.fn(),
  deskLogout: vi.fn(),
}));
vi.mock('#/server/desk/count-tasks.fn', () => ({ listWorkers }));
vi.mock('#/server/desk/exceptions.fn', () => ({
  listExceptions,
  getExceptionDetail: vi.fn(),
  resolveException: vi.fn(),
}));

import { ExceptionsListPage } from '#/routes/w/$warehouseId/exceptions.index';
import { DeskLayoutView } from '#/routes/w/$warehouseId/route';

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

function mount(ui: () => React.ReactNode, qc: QueryClient) {
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: ui,
  });
  const router = createRouter({
    routeTree: root,
    context: { queryClient: qc },
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return render(
    <QueryClientProvider client={qc}>
      <MantineProvider>
        <RouterProvider router={router} />
      </MantineProvider>
    </QueryClientProvider>,
  );
}

const client = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

describe('desk layout session expiry', () => {
  it('navigates to /desk/login when the warehouses query rejects with HttpError(401)', async () => {
    getWarehouses.mockRejectedValue(new HttpError(401, 'HTTP 401'));
    const navigate = vi.fn();
    mount(
      () => (
        <DeskLayoutView
          warehouseId="wh1"
          session={{ name: 'Sue' }}
          navigate={navigate}
        />
      ),
      client(),
    );
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/desk/login'));
  });

  it('navigates to /desk/login when a save reports an expired session', async () => {
    getWarehouses.mockResolvedValue([]);
    const navigate = vi.fn();
    mount(
      () => (
        <DeskLayoutView
          warehouseId="wh1"
          session={{ name: 'Sue' }}
          navigate={navigate}
        />
      ),
      client(),
    );
    await screen.findByText('Sue');
    notifySessionExpired();
    expect(navigate).toHaveBeenCalledWith('/desk/login');
  });

  it('does not crash when warehouses resolves to a raw Response', async () => {
    getWarehouses.mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );
    const navigate = vi.fn();
    const qc = client();
    mount(
      () => (
        <DeskLayoutView
          warehouseId="wh1"
          session={{ name: 'Sue' }}
          navigate={navigate}
        />
      ),
      qc,
    );
    await waitFor(() =>
      expect(qc.getQueryState(['desk', 'warehouses'])?.status).toBe('success'),
    );
    expect(screen.getByText('Sue')).toBeTruthy();
    expect(screen.queryByText('Warehouse not found')).toBeNull();
  });
});

describe('non-array results', () => {
  it('renders the exceptions page when workers resolves to a Response', async () => {
    listWorkers.mockResolvedValue(
      new Response('Unauthorized', { status: 401 }),
    );
    listExceptions.mockResolvedValue({
      ok: false,
      code: 'NOT_READY',
      message: 'Warehouse is not ready',
    });
    mount(() => <ExceptionsListPage warehouseId="wh1" />, client());
    expect(await screen.findByText('Warehouse is not ready')).toBeTruthy();
    await waitFor(() => expect(listWorkers).toHaveBeenCalled());
  });
});
