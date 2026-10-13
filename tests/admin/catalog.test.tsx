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
import { parseProductSearch } from '#/admin/catalog-input';
import { onSessionExpired } from '#/desk/auth-error';
import type {
  CategoryRow,
  ProductRow,
  ReasonCodeRow,
} from '#/server/admin/catalog.server';
import { HttpError } from '#/shared/checked-fetch';

const fns = vi.hoisted(() => ({
  listProducts: vi.fn(),
  createProduct: vi.fn(),
  updateProduct: vi.fn(),
  listCategories: vi.fn(),
  createCategory: vi.fn(),
  updateCategory: vi.fn(),
  listReasonCodesAdmin: vi.fn(),
  createReasonCode: vi.fn(),
  updateReasonCode: vi.fn(),
}));
vi.mock('#/server/admin/catalog.fn', () => fns);

import { CategoriesPage } from '#/routes/admin/categories';
import { ProductsPage } from '#/routes/admin/products';
import { ReasonCodesPage } from '#/routes/admin/reason-codes';

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
  vi.resetAllMocks();
});

const product = (over: Partial<ProductRow>): ProductRow => ({
  id: 'p1',
  sku: 'SKU1',
  name: 'Widget',
  barcodes: ['1234567'],
  uom: 'EA',
  categoryId: null,
  categoryName: null,
  countTolerance: null,
  effectiveTolerance: 0,
  ...over,
});
const category = (over: Partial<CategoryRow>): CategoryRow => ({
  id: 'c1',
  name: 'Tools',
  countTolerance: 3,
  productCount: 1,
  ...over,
});
const reason = (over: Partial<ReasonCodeRow>): ReasonCodeRow => ({
  code: 'DAMAGED',
  label: 'Damaged',
  appliesTo: ['ADJUST'],
  system: false,
  ...over,
});

function mount(url: string, path: string, page: ReactNode) {
  const root = createRootRoute();
  const route = createRoute({
    getParentRoute: () => root,
    path,
    validateSearch: parseProductSearch,
    component: () => page,
  });
  const router = createRouter({
    routeTree: root.addChildren([route]),
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

describe('ProductsPage', () => {
  it('shows the category tolerance fallback, own tolerance and a dash', async () => {
    fns.listCategories.mockResolvedValue([category({})]);
    fns.listProducts.mockResolvedValue([
      product({
        id: 'a',
        sku: 'A',
        categoryId: 'c1',
        categoryName: 'Tools',
        effectiveTolerance: 3,
      }),
      product({ id: 'b', sku: 'B', countTolerance: 7, effectiveTolerance: 7 }),
      product({ id: 'c', sku: 'C' }),
    ]);
    mount('/admin/products', '/admin/products', <ProductsPage />);
    expect(await screen.findByText('category: 3')).toBeTruthy();
    expect(screen.getByText('7')).toBeTruthy();
    const rowC = screen.getByText('C').closest('tr');
    expect(rowC?.textContent).toContain('—');
  });

  it('applies ?search= and falls back to empty on a bad param', async () => {
    fns.listCategories.mockResolvedValue([]);
    fns.listProducts.mockResolvedValue([]);
    mount('/admin/products?search=wid', '/admin/products', <ProductsPage />);
    await waitFor(() =>
      expect(fns.listProducts).toHaveBeenCalledWith(
        expect.objectContaining({ data: { search: 'wid' } }),
      ),
    );
    cleanup();
    fns.listProducts.mockClear();
    mount('/admin/products?search=1', '/admin/products', <ProductsPage />);
    await waitFor(() =>
      expect(fns.listProducts).toHaveBeenCalledWith(
        expect.objectContaining({ data: {} }),
      ),
    );
    expect((screen.getByLabelText('Search') as HTMLInputElement).value).toBe(
      '',
    );
  });

  it('shows an INVALID in the drawer and keeps the input', async () => {
    fns.listCategories.mockResolvedValue([category({})]);
    fns.listProducts.mockResolvedValue([]);
    fns.createProduct.mockResolvedValue({
      ok: false,
      code: 'INVALID',
      message: '1234567 is already used by SKU9 Other',
    });
    mount('/admin/products', '/admin/products', <ProductsPage />);
    fireEvent.click(await screen.findByText('New product'));
    fireEvent.change(await screen.findByLabelText('SKU'), {
      target: { value: 'SKU1' },
    });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Widget' },
    });
    fireEvent.click(screen.getByText('Create product'));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'already used by',
    );
    expect((screen.getByLabelText('SKU') as HTMLInputElement).value).toBe(
      'SKU1',
    );
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Widget',
    );
  });
});

describe('ProductsPage save errors', () => {
  async function submitNewProduct() {
    fns.listCategories.mockResolvedValue([category({})]);
    fns.listProducts.mockResolvedValue([]);
    mount('/admin/products', '/admin/products', <ProductsPage />);
    fireEvent.click(await screen.findByText('New product'));
    fireEvent.change(await screen.findByLabelText('SKU'), {
      target: { value: 'SKU1' },
    });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Widget' },
    });
    fireEvent.click(screen.getByText('Create product'));
  }

  it('sends a 401 on save to sign-in instead of an inline error', async () => {
    fns.createProduct.mockRejectedValue(
      new HttpError(401, '{"error":"Unauthorized"}'),
    );
    const expired = vi.fn();
    const stop = onSessionExpired(expired);
    await submitNewProduct();
    await waitFor(() => expect(expired).toHaveBeenCalledTimes(1));
    stop();
    expect(screen.queryByRole('alert')).toBeNull();
    expect((screen.getByLabelText('SKU') as HTMLInputElement).value).toBe(
      'SKU1',
    );
  });

  it('shows a readable message, not raw JSON, for a thrown JSON error', async () => {
    fns.createProduct.mockRejectedValue(
      new Error('{"error":"Database is locked"}'),
    );
    await submitNewProduct();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Database is locked');
    expect(alert.textContent).not.toContain('{');
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Widget',
    );
  });
});

describe('CategoriesPage', () => {
  it('saves an inline edit', async () => {
    fns.listCategories.mockResolvedValue([category({})]);
    fns.updateCategory.mockResolvedValue({ ok: true });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider>
          <CategoriesPage />
        </MantineProvider>
      </QueryClientProvider>,
    );
    fireEvent.change(await screen.findByLabelText('Tolerance Tools'), {
      target: { value: '5' },
    });
    fireEvent.click(screen.getByLabelText('Save Tools'));
    await waitFor(() =>
      expect(fns.updateCategory).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { categoryId: 'c1', name: 'Tools', countTolerance: 5 },
        }),
      ),
    );
  });
});

describe('ReasonCodesPage', () => {
  it('disables the edit controls of system codes', async () => {
    fns.listReasonCodesAdmin.mockResolvedValue([
      reason({ code: 'INITIAL', label: 'Initial', system: true }),
      reason({}),
    ]);
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MantineProvider>
          <ReasonCodesPage />
        </MantineProvider>
      </QueryClientProvider>,
    );
    expect(await screen.findByText('System')).toBeTruthy();
    expect(
      (screen.getByLabelText('Label INITIAL') as HTMLInputElement).disabled,
    ).toBe(true);
    const inputs = screen
      .getAllByLabelText('Applies to INITIAL')
      .filter((el) => el.tagName === 'INPUT') as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThan(0);
    expect(inputs.every((el) => el.disabled)).toBe(true);
    expect(
      (screen.getByLabelText('Save INITIAL') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText('Label DAMAGED') as HTMLInputElement).disabled,
    ).toBe(false);
  });
});
