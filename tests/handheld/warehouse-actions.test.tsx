// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import {
  createMemoryHistory,
  createRootRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { WarehouseActions } from '#/handheld/components/WarehouseActions';

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

describe('WarehouseActions', () => {
  it('shows each action with its text name, link and one decorative icon', async () => {
    const root = createRootRoute({
      component: () => <WarehouseActions wh="wh-1" />,
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
    const expected = [
      ['Stock', '/h/wh-1/stock'],
      ['Count', '/h/wh-1/count'],
      ['Move', '/h/wh-1/move'],
      ['Transfer in', '/h/wh-1/transfer-in'],
      ['Pick', '/h/wh-1/pick'],
      ['Adjust', '/h/wh-1/adjust'],
    ] as const;
    for (const [name, href] of expected) {
      const link = await screen.findByRole('link', { name });
      expect(link.getAttribute('href')).toBe(href);
      expect(link.querySelectorAll('svg[aria-hidden="true"]')).toHaveLength(1);
      expect(Number.parseInt(link.style.minHeight, 10)).toBeGreaterThanOrEqual(
        48,
      );
    }
  });
});
