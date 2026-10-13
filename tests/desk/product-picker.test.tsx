// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { type ReactNode, useState } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { deskFetch } from '#/shared/checked-fetch';

const listProducts = vi.hoisted(() => vi.fn());
vi.mock('#/server/admin/catalog.fn', () => ({ listProducts }));

import { ProductPicker } from '#/desk/components/ProductPicker';

beforeAll(() => {
  window.scrollTo = () => {};
  Element.prototype.scrollIntoView = () => {};
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

const ALL = [
  { id: 'p1', sku: 'SKU-1', name: 'Widget' },
  { id: 'p2', sku: 'SKU-2', name: 'Gadget' },
];

function searchByName() {
  listProducts.mockImplementation(
    async ({ data }: { data: { search?: string } }) =>
      ALL.filter((p) => p.name.toLowerCase().includes(data.search ?? '')),
  );
}

function Harness({ onValue }: { onValue: (v: string | null) => void }) {
  const [v, setV] = useState<string | null>(null);
  return (
    <ProductPicker
      label="Product"
      value={v}
      onChange={(id) => {
        setV(id);
        onValue(id);
      }}
    />
  );
}

function mount(ui: ReactNode) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );
}

const input = () => screen.getByRole('combobox', { name: 'Product' });

describe('ProductPicker', () => {
  it('searches through listProducts and emits the product id', async () => {
    searchByName();
    const onValue = vi.fn();
    mount(<Harness onValue={onValue} />);
    fireEvent.click(input());
    // Mantine ignores change events on an unfocused input (browser autofill).
    act(() => input().focus());
    fireEvent.change(input(), { target: { value: 'gadget' } });
    await waitFor(() =>
      expect(listProducts).toHaveBeenCalledWith({
        fetch: deskFetch,
        data: { search: 'gadget' },
      }),
    );
    fireEvent.click(
      await screen.findByRole('option', {
        name: 'SKU-2 · Gadget',
        hidden: true,
      }),
    );
    expect(onValue).toHaveBeenCalledWith('p2');
    expect((input() as HTMLInputElement).value).toBe('SKU-2 · Gadget');
  });

  it('keeps the selected label when the search no longer returns it', async () => {
    searchByName();
    mount(<Harness onValue={vi.fn()} />);
    fireEvent.click(input());
    fireEvent.click(
      await screen.findByRole('option', {
        name: 'SKU-1 · Widget',
        hidden: true,
      }),
    );
    // Mantine ignores change events on an unfocused input (browser autofill).
    act(() => input().focus());
    fireEvent.change(input(), { target: { value: 'gadget' } });
    await waitFor(() =>
      expect(listProducts).toHaveBeenCalledWith({
        fetch: deskFetch,
        data: { search: 'gadget' },
      }),
    );
    await screen.findByRole('option', { name: 'SKU-2 · Gadget', hidden: true });
    expect(
      screen.getByRole('option', { name: 'SKU-1 · Widget', hidden: true }),
    ).toBeTruthy();
  });

  it('shows an inline alert when the load fails', async () => {
    listProducts.mockRejectedValue(new Error('down'));
    mount(<Harness onValue={vi.fn()} />);
    expect(await screen.findByText("Couldn't load products")).toBeTruthy();
  });
});
