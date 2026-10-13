// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  createMemoryHistory,
  createRootRoute,
  createRootRouteWithContext,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { adminTarget } from '#/admin/admin-target';
import { AdminNav } from '#/admin/components/AdminNav';
import { HttpError } from '#/shared/checked-fetch';

vi.mock('#/server/desk/desk-auth.fn', () => ({
  getWarehouses: vi.fn().mockResolvedValue([]),
  getDeskSession: vi.fn(),
  deskLogout: vi.fn(),
}));

import { AdminLayoutView } from '#/routes/admin/route';
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

function mount(ui: () => React.ReactNode, qc = new QueryClient()) {
  const root = createRootRouteWithContext<{ queryClient: QueryClient }>()({
    component: ui,
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
    context: { queryClient: qc },
  });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <RouterProvider router={router} />
      </QueryClientProvider>
    </MantineProvider>,
  );
}

describe('adminTarget', () => {
  it('login without a session', () => {
    expect(adminTarget(null)).toBe('/desk/login');
  });
  it('desk for a non-admin', () => {
    expect(adminTarget({ role: 'supervisor' })).toBe('/');
  });
  it('null for an admin', () => {
    expect(adminTarget({ role: 'admin' })).toBeNull();
  });
});

describe('AdminNav', () => {
  it('renders the six section links', async () => {
    const root = createRootRoute({ component: AdminNav });
    const leaf = createRoute({
      getParentRoute: () => root,
      path: '/admin/$page',
    });
    const router = createRouter({
      routeTree: root.addChildren([leaf]),
      history: createMemoryHistory({ initialEntries: ['/admin/users'] }),
    });
    render(
      <MantineProvider>
        <RouterProvider router={router} />
      </MantineProvider>,
    );
    await waitFor(() => screen.getByText('Warehouses'));
    const href = (name: string) =>
      screen.getByText(name).closest('a')?.getAttribute('href');
    expect(href('Warehouses')).toBe('/admin/warehouses');
    expect(href('Users')).toBe('/admin/users');
    expect(href('Devices')).toBe('/admin/devices');
    expect(href('Products')).toBe('/admin/products');
    expect(href('Categories')).toBe('/admin/categories');
    expect(href('Reason codes')).toBe('/admin/reason-codes');
  });
});

describe('desk header Admin link', () => {
  it('shows for admins', async () => {
    mount(() => (
      <DeskLayoutView
        warehouseId="wh-1"
        session={{ name: 'Root', role: 'admin' }}
      />
    ));
    expect(await screen.findByText('Admin')).toBeTruthy();
  });
  it('is hidden for supervisors', async () => {
    mount(() => (
      <DeskLayoutView
        warehouseId="wh-1"
        session={{ name: 'Sup', role: 'supervisor' }}
      />
    ));
    await screen.findByText('Sup');
    expect(screen.queryByText('Admin')).toBeNull();
  });
});

describe('AdminLayoutView', () => {
  it('navigates to /desk/login when an admin query fails with 401', async () => {
    const qc = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const navigate = vi.fn();
    mount(
      () => <AdminLayoutView session={{ name: 'Root' }} navigate={navigate} />,
      qc,
    );
    await screen.findByText('Root');
    await qc
      .fetchQuery({
        queryKey: ['admin', 'users'],
        queryFn: () => Promise.reject(new HttpError(401, 'HTTP 401')),
      })
      .catch(() => {});
    await waitFor(() => expect(navigate).toHaveBeenCalledWith('/desk/login'));
  });
});
