// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AdminLocationRow } from '#/server/admin/locations.server';

const fns = vi.hoisted(() => ({
  listLocationsAdmin: vi.fn(),
  createLocation: vi.fn(),
  updateLocation: vi.fn(),
  setLocationActive: vi.fn(),
  listWarehousesAdmin: vi.fn(),
}));
vi.mock('#/server/admin/locations.fn', () => fns);
vi.mock('#/server/admin/warehouses.fn', () => fns);
vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-router')>()),
  Link: ({ children }: { children: ReactNode }) => <a href="/x">{children}</a>,
}));

import { LocationForm } from '#/admin/components/LocationForm';
import { LocationsPage } from '#/routes/admin/warehouses.$warehouseId.locations';

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

const loc = (over: Partial<AdminLocationRow>): AdminLocationRow => ({
  id: 'wh1-A1',
  code: 'A1',
  zone: null,
  active: true,
  stockUnits: 0,
  ...over,
});

function mount(ui: ReactNode, client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe('LocationsPage', () => {
  it('asks before deactivating a location with stock; cancel makes no call', async () => {
    fns.listWarehousesAdmin.mockResolvedValue([{ id: 'wh1', name: 'Main' }]);
    fns.listLocationsAdmin.mockResolvedValue({
      ok: true,
      locations: [loc({ stockUnits: 5 })],
    });
    mount(<LocationsPage warehouseId="wh1" />);
    fireEvent.click(await screen.findByLabelText('Active A1'));
    expect(
      await screen.findByText('A1 still holds 5 units. Deactivate anyway?'),
    ).toBeTruthy();
    fireEvent.click(screen.getByText('Cancel'));
    expect(fns.setLocationActive).not.toHaveBeenCalled();
  });

  it('confirming deactivates and shows the server warning', async () => {
    fns.listWarehousesAdmin.mockResolvedValue([]);
    fns.listLocationsAdmin.mockResolvedValue({
      ok: true,
      locations: [loc({ stockUnits: 5 })],
    });
    fns.setLocationActive.mockResolvedValue({
      ok: true,
      warning: 'Location still holds 5 units',
    });
    mount(<LocationsPage warehouseId="wh1" />);
    fireEvent.click(await screen.findByLabelText('Active A1'));
    fireEvent.click(await screen.findByText('Deactivate'));
    await waitFor(() =>
      expect(fns.setLocationActive).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { warehouseId: 'wh1', locationId: 'wh1-A1', active: false },
        }),
      ),
    );
    expect(
      await screen.findByText('Location still holds 5 units'),
    ).toBeTruthy();
  });

  it('deactivating an empty location needs no confirmation', async () => {
    fns.listWarehousesAdmin.mockResolvedValue([]);
    fns.listLocationsAdmin.mockResolvedValue({
      ok: true,
      locations: [loc({})],
    });
    fns.setLocationActive.mockResolvedValue({ ok: true });
    mount(<LocationsPage warehouseId="wh1" />);
    fireEvent.click(await screen.findByLabelText('Active A1'));
    await waitFor(() => expect(fns.setLocationActive).toHaveBeenCalledTimes(1));
  });

  it('keeps data and shows a refresh note when a poll fails', async () => {
    fns.listWarehousesAdmin.mockResolvedValue([]);
    fns.listLocationsAdmin.mockResolvedValueOnce({
      ok: true,
      locations: [loc({})],
    });
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mount(<LocationsPage warehouseId="wh1" />, client);
    await screen.findByText('A1');
    fns.listLocationsAdmin.mockRejectedValue(new Error('down'));
    await client.refetchQueries({ queryKey: ['admin', 'locations', 'wh1'] });
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText('A1')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});

describe('LocationForm', () => {
  it('shows a duplicate-code INVALID in the drawer and keeps the input', async () => {
    fns.createLocation.mockResolvedValue({
      ok: false,
      code: 'INVALID',
      message: 'Code A1 is already used',
    });
    const onDone = vi.fn();
    mount(<LocationForm warehouseId="wh1" onDone={onDone} />);
    fireEvent.change(screen.getByLabelText(/Code/), {
      target: { value: 'A1' },
    });
    fireEvent.change(screen.getByLabelText('Zone'), {
      target: { value: 'Z' },
    });
    fireEvent.click(screen.getByText('Create location'));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'already used',
    );
    expect(onDone).not.toHaveBeenCalled();
    expect((screen.getByLabelText(/Code/) as HTMLInputElement).value).toBe(
      'A1',
    );
    expect((screen.getByLabelText('Zone') as HTMLInputElement).value).toBe('Z');
  });
});
