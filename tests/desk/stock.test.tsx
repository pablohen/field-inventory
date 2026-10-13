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
import { cleanup, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { parseLedgerSearch, parseStockSearch } from '#/desk/stock-filters';
import type { LedgerRow, StockRow } from '#/server/desk/stock.server';

import { deskFetch } from '#/shared/checked-fetch';

const getStock = vi.hoisted(() => vi.fn());
const getLedger = vi.hoisted(() => vi.fn());
vi.mock('#/server/desk/stock.fn', () => ({
  getStock,
  getLedger,
  listReasonCodes: vi.fn(),
}));
vi.mock('#/server/admin/catalog.fn', () => ({
  listProducts: async () => [{ id: 'S1', sku: 'SKU-1', name: 'One' }],
}));
vi.mock('#/server/desk/count-tasks.fn', () => ({
  listWorkers: async () => [{ id: 'w1', name: 'Wendy' }],
}));

import { StockPage } from '#/routes/w/$warehouseId/stock.index';
import { LedgerPage } from '#/routes/w/$warehouseId/stock.ledger';

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

function mount(
  url: string,
  path: string,
  page: ReactNode,
  validateSearch: (s: Record<string, unknown>) => Record<string, unknown>,
) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path,
    validateSearch,
    component: () => page,
  });
  const others = ['/w/$warehouseId/stock', '/w/$warehouseId/stock/ledger']
    .filter((p) => p !== path)
    .map((p) => createRoute({ getParentRoute: () => root, path: p }));
  const router = createRouter({
    routeTree: root.addChildren([route, ...others]),
    history: createMemoryHistory({ initialEntries: [url] }),
  });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>
        <RouterProvider router={router} />
      </MantineProvider>
    </QueryClientProvider>,
  );
  return router;
}

describe('stock page', () => {
  const rows: StockRow[] = [
    {
      skuId: 'S1',
      sku: 'SKU-1',
      name: 'Widget',
      locationId: 'L1',
      locationCode: 'A-01',
      qty: -3,
    },
    {
      skuId: 'S2',
      sku: 'SKU-2',
      name: 'Gadget',
      locationId: 'L2',
      locationCode: 'B-02',
      qty: 5,
    },
  ];

  function stockPage(url = `/w/${WH}/stock`) {
    getStock.mockResolvedValue({ ok: true, rows });
    return mount(
      url,
      '/w/$warehouseId/stock',
      <StockPage warehouseId={WH} />,
      parseStockSearch,
    );
  }

  it('renders negative qty in red and positive qty plainly', async () => {
    stockPage();
    const neg = (await screen.findByText('-3')).closest('td');
    expect(neg?.dataset.negative).toBe('true');
    expect(neg?.getAttribute('style') ?? '').toContain('red');
    const pos = screen.getByText('5').closest('td');
    expect(pos?.dataset.negative).toBeUndefined();
    expect(pos?.getAttribute('style') ?? '').not.toContain('red');
  });

  it('links rows to the ledger with the right search params', async () => {
    stockPage();
    const link = await screen.findByText('SKU-1');
    const href = link.closest('a')?.getAttribute('href') ?? '';
    const url = new URL(href, 'http://x');
    expect(url.pathname).toBe(`/w/${WH}/stock/ledger`);
    expect(url.searchParams.get('skuId')).toBe('S1');
    expect(url.searchParams.get('locationId')).toBe('L1');
  });

  it('falls back to default filters on a bad shared URL', async () => {
    stockPage(`/w/${WH}/stock?nonZero=maybe`);
    expect(await screen.findByText('SKU-1')).toBeTruthy();
    expect(getStock).toHaveBeenCalledWith({
      fetch: deskFetch,
      data: { warehouseId: WH, filters: {} },
    });
  });
});

describe('ledger page', () => {
  const lrow = (
    seq: number,
    delta: number,
    runningBalance: number,
    source = 'device',
  ): LedgerRow => ({
    id: `m${seq}`,
    seq,
    type: 'COUNT',
    skuId: 'S1',
    fromLocationId: null,
    toLocationId: 'L1',
    qty: Math.abs(delta),
    reasonCode: null,
    userId: 'w1',
    deviceId: 'dev1',
    source,
    occurredAt: '2026-03-01T10:00:00.000Z',
    receivedAt: '2026-03-01T10:01:00.000Z',
    involved: false,
    delta,
    runningBalance,
  });

  it('shows the running balance; the last equals the header balance', async () => {
    getLedger.mockResolvedValue({
      ok: true,
      balance: 7,
      rows: [lrow(1, 10, 10), lrow(2, -3, 7, 'supervisor')],
    });
    mount(
      `/w/${WH}/stock/ledger?skuId=S1&locationId=L1`,
      '/w/$warehouseId/stock/ledger',
      <LedgerPage warehouseId={WH} />,
      parseLedgerSearch,
    );
    const header = await screen.findByTestId('ledger-header-balance');
    const balances = screen
      .getAllByTestId('ledger-balance')
      .map((e) => e.textContent);
    expect(balances).toEqual(['10', '7']);
    expect(balances.at(-1)).toBe(header.textContent);
    expect(screen.getByText('supervisor')).toBeTruthy();
    expect(getLedger).toHaveBeenCalledWith({
      fetch: deskFetch,
      data: { warehouseId: WH, key: { skuId: 'S1', locationId: 'L1' } },
    });
  });

  it('prompts to pick a stock row when params are missing', async () => {
    mount(
      `/w/${WH}/stock/ledger`,
      '/w/$warehouseId/stock/ledger',
      <LedgerPage warehouseId={WH} />,
      parseLedgerSearch,
    );
    expect(
      await screen.findByText('Pick a stock row to see its ledger.'),
    ).toBeTruthy();
    const link = screen.getByRole('link', { name: /Stock/ });
    expect(link.getAttribute('href')).toBe(`/w/${WH}/stock`);
    expect(getLedger).not.toHaveBeenCalled();
  });
});
