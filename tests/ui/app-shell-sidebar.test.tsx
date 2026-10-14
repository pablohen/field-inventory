// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { PackageIcon } from '@phosphor-icons/react';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AppShellSidebar, inCollapsedRail } from '#/ui/AppShellSidebar';
import { requestTourReplay, TOUR_KEYS } from '#/ui/onboarding';

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

describe('AppShellSidebar icons', () => {
  it('draws a decorative icon before a link label when one is given', async () => {
    const root = createRootRoute({
      component: () => (
        <AppShellSidebar
          switcher={null}
          links={[
            { label: 'Stock', to: '/a', active: true, icon: PackageIcon },
            { label: 'Plain', to: '/b', active: false },
          ]}
          footer={null}
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
    const stock = await screen.findByRole('link', { name: 'Stock' });
    expect(stock.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
    const plain = screen.getByRole('link', { name: 'Plain' });
    expect(plain.querySelector('svg')).toBeNull();
  });
});

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

  it('hides the closed drawer from the tab order and controls it from the burger', async () => {
    await mountSidebar();
    const burger = screen.getByRole('button', { name: 'Open navigation' });
    const navbar = document.getElementById(
      burger.getAttribute('aria-controls') ?? 'missing',
    ) as HTMLElement;
    expect(navbar).toBeTruthy();
    expect(navbar.classList.contains('fi-rail')).toBe(true);
    // CSS (tokens.css) hides `.fi-rail:not([data-open])` below 900px.
    expect(navbar.hasAttribute('data-open')).toBe(false);
    fireEvent.click(burger);
    expect(navbar.hasAttribute('data-open')).toBe(true);
  });

  it('closes the mobile drawer when a tour replay is requested', async () => {
    await mountSidebar();
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    const navbar = document.getElementById('fi-navbar') as HTMLElement;
    expect(navbar.hasAttribute('data-open')).toBe(true);
    act(() => requestTourReplay(TOUR_KEYS.desk));
    expect(navbar.hasAttribute('data-open')).toBe(false);
  });

  it('reports rail elements as collapsed on narrow screens while the drawer is shut', async () => {
    // The beforeAll matchMedia stub reports a 600px (narrow) viewport.
    await mountSidebar();
    const link = screen.getByRole('link', { name: 'Stock' });
    expect(inCollapsedRail(link)).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Open navigation' }));
    expect(inCollapsedRail(link)).toBe(false);
    expect(inCollapsedRail(screen.getByText('content'))).toBe(false);
  });

  it('titles long link labels and footer text with the full string', async () => {
    await mountSidebar();
    expect(screen.getByRole('link', { name: LONG }).getAttribute('title')).toBe(
      LONG,
    );
    expect(screen.getByText(LONG, { selector: 'span[title]' })).toBeTruthy();
  });
});
