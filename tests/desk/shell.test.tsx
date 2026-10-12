// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
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
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { DeskNav, switchWarehousePath } from '#/desk/components/DeskNav';
import { deskHomeTarget } from '#/desk/home-target';

const deskLogin = vi.hoisted(() => vi.fn());
vi.mock('#/server/desk/desk-auth.fn', () => ({
  deskLogin,
  deskLogout: vi.fn(),
  getDeskSession: vi.fn(),
  getWarehouses: vi.fn(),
}));
vi.mock('#/shared/checked-fetch', () => ({ checkedFetch: () => fetch }));

import { DeskLogin } from '#/routes/desk/login';

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

describe('deskHomeTarget', () => {
  const s = { userId: 'u1' };
  it('login without a session', () => {
    expect(deskHomeTarget(null, [{ id: 'a' }])).toBe('/desk/login');
  });
  it('first warehouse exceptions', () => {
    expect(deskHomeTarget(s, [{ id: 'wh-1' }, { id: 'wh-2' }])).toBe(
      '/w/wh-1/exceptions',
    );
  });
  it('null with no warehouses', () => {
    expect(deskHomeTarget(s, [])).toBeNull();
  });
});

describe('login page', () => {
  const cases = [
    ['BAD_CREDENTIALS', 'Wrong username or PIN'],
    ['NOT_ALLOWED', "This account can't use the desk"],
    ['LOCKED', 'Too many attempts. Try again in 15 minutes.'],
  ] as const;

  it.each(cases)('shows the message for %s', async (reason, message) => {
    deskLogin.mockResolvedValue({ ok: false, reason });
    const router = createRouter({
      routeTree: createRootRoute({ component: DeskLogin }),
      history: createMemoryHistory({ initialEntries: ['/'] }),
    });
    render(
      <MantineProvider>
        <RouterProvider router={router} />
      </MantineProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Username'), {
      target: { value: 'sup' },
    });
    const digits = document.querySelectorAll('.mantine-PinInput-input');
    for (const [i, el] of [...digits].entries()) {
      fireEvent.change(el, { target: { value: String(i + 1) } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText(message)).toBeTruthy();
  });
});

describe('DeskNav', () => {
  it('switchWarehousePath keeps the sub-page', () => {
    expect(switchWarehousePath('/w/wh-1/stock', 'wh-2')).toBe('/w/wh-2/stock');
  });

  it('renders the four links for the current warehouse', async () => {
    const root = createRootRoute({
      component: () => (
        <DeskNav
          warehouseId="wh-1"
          warehouses={[
            { id: 'wh-1', name: 'One' },
            { id: 'wh-2', name: 'Two' },
          ]}
          pathname="/w/wh-1/stock"
        />
      ),
    });
    const leaf = createRoute({
      getParentRoute: () => root,
      path: '/w/$warehouseId/$page',
    });
    const router = createRouter({
      routeTree: root.addChildren([leaf]),
      history: createMemoryHistory({ initialEntries: ['/w/wh-1/stock'] }),
    });
    render(
      <MantineProvider>
        <RouterProvider router={router} />
      </MantineProvider>,
    );
    await waitFor(() => screen.getByText('Exceptions'));
    const href = (name: string) =>
      screen.getByText(name).closest('a')?.getAttribute('href');
    expect(href('Exceptions')).toBe('/w/wh-1/exceptions');
    expect(href('Stock')).toBe('/w/wh-1/stock');
    expect(href('Pick lists')).toBe('/w/wh-1/pick-lists');
    expect(href('Counts')).toBe('/w/wh-1/counts');
  });
});
