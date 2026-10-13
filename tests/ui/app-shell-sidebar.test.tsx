// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import {
  createMemoryHistory,
  createRootRoute,
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
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppShellSidebar } from '#/ui/AppShellSidebar';

const LONG = 'x'.repeat(60);

beforeAll(() => {
  window.matchMedia = ((q: string) => ({
    // A 600px viewport: only max-width queries wider than 600 match.
    matches: /max-width/.test(q),
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

async function mountSidebar() {
  const root = createRootRoute({
    component: () => (
      <AppShellSidebar
        switcher={<span>Switcher</span>}
        links={[
          { label: 'Stock', to: '/admin/users', active: true },
          { label: LONG, to: '/admin/devices', active: false },
        ]}
        footer={<span title={LONG}>{LONG}</span>}
      >
        <p>content</p>
      </AppShellSidebar>
    ),
  });
  const router = createRouter({
    routeTree: root,
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  render(
    <MantineProvider>
      <RouterProvider router={router} />
    </MantineProvider>,
  );
  await waitFor(() => screen.getByText('Stock'));
}

describe('AppShellSidebar', () => {
  it('marks only the active link with aria-current', async () => {
    await mountSidebar();
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('aria-current')).toBe('page');
    expect(links[1]?.getAttribute('aria-current')).toBeNull();
  });

  it('shows a burger on narrow screens that opens the nav', async () => {
    await mountSidebar();
    const burger = screen.getByRole('button', { name: 'Open navigation' });
    expect(burger.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(burger);
    expect(
      screen
        .getByRole('button', { name: 'Close navigation' })
        .getAttribute('aria-expanded'),
    ).toBe('true');
    // Links render once; the navbar is toggled, not duplicated.
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('titles long link labels and footer text with the full string', async () => {
    await mountSidebar();
    expect(screen.getByRole('link', { name: LONG }).getAttribute('title')).toBe(
      LONG,
    );
    expect(screen.getByText(LONG, { selector: 'span[title]' })).toBeTruthy();
  });
});
