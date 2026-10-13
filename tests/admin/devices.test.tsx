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
import type { AdminDeviceRow } from '#/server/admin/devices.server';

const fns = vi.hoisted(() => ({
  listDevices: vi.fn(),
  enrollDevice: vi.fn(),
  setDeviceWarehouses: vi.fn(),
  setDeviceRevoked: vi.fn(),
  listWarehousesAdmin: vi.fn(),
}));
vi.mock('#/server/admin/devices.fn', () => fns);
vi.mock('#/server/admin/warehouses.fn', () => fns);

import { DeviceTable, REMOVED_HINT } from '#/admin/components/DeviceTable';
import { DevicesPage } from '#/routes/admin/devices';

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
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

const wh = [
  {
    id: 'north',
    name: 'North DC',
    status: 'SETUP_INCOMPLETE' as const,
    tursoDbName: 'n',
    schemaVersion: 0,
    deviceCount: 0,
  },
  {
    id: 'south',
    name: 'South DC',
    status: 'READY' as const,
    tursoDbName: 's',
    schemaVersion: 1,
    deviceCount: 1,
  },
];

const dev = (over: Partial<AdminDeviceRow>): AdminDeviceRow => ({
  id: 'dev-1',
  label: 'Dock 1',
  enrolledAt: new Date('2026-01-02T03:04:05Z'),
  revoked: false,
  warehouseIds: ['south'],
  ...over,
});

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mount(ui: ReactNode, client = newClient()) {
  render(
    <QueryClientProvider client={client}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );
  return client;
}

describe('DeviceTable', () => {
  it('asks for confirmation with the exact text before revoking', async () => {
    fns.setDeviceRevoked.mockResolvedValue({ ok: true });
    mount(<DeviceTable rows={[dev({})]} warehouses={wh} />);
    fireEvent.click(screen.getByLabelText('Revoke Dock 1'));
    expect(
      await screen.findByText(
        'Revoke Dock 1? It will stop syncing; recorded work stays in its outbox.',
      ),
    ).toBeTruthy();
    expect(fns.setDeviceRevoked).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Revoke' }));
    await waitFor(() =>
      expect(fns.setDeviceRevoked).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { deviceId: 'dev-1', revoked: true },
        }),
      ),
    );
  });

  it('shows a Revoked badge and restores without confirmation', async () => {
    fns.setDeviceRevoked.mockResolvedValue({ ok: true });
    mount(<DeviceTable rows={[dev({ revoked: true })]} warehouses={wh} />);
    expect(screen.getByText('Revoked')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Restore Dock 1'));
    await waitFor(() =>
      expect(fns.setDeviceRevoked).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { deviceId: 'dev-1', revoked: false },
        }),
      ),
    );
  });

  it('saves the full new warehouse set and labels non-ready ones', async () => {
    fns.setDeviceWarehouses.mockResolvedValue({ ok: true });
    mount(<DeviceTable rows={[dev({})]} warehouses={wh} />);
    fireEvent.click(screen.getAllByLabelText('Warehouses for Dock 1')[0]);
    fireEvent.click(
      await screen.findByRole('option', {
        name: 'North DC (Setup incomplete)',
        hidden: true,
      }),
    );
    await waitFor(() =>
      expect(fns.setDeviceWarehouses).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { deviceId: 'dev-1', warehouseIds: ['south', 'north'] },
        }),
      ),
    );
    expect(screen.queryByText(REMOVED_HINT)).toBeNull();
  });

  it('shows the removal hint after removing a warehouse', async () => {
    fns.setDeviceWarehouses.mockResolvedValue({ ok: true });
    mount(<DeviceTable rows={[dev({})]} warehouses={wh} />);
    const remove = document.querySelector<HTMLElement>('.mantine-Pill-remove');
    if (!remove) throw new Error('no pill remove');
    fireEvent.click(remove);
    await waitFor(() =>
      expect(fns.setDeviceWarehouses).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { deviceId: 'dev-1', warehouseIds: [] },
        }),
      ),
    );
    expect(await screen.findByText(REMOVED_HINT)).toBeTruthy();
  });

  it('shows a refusal in the row', async () => {
    fns.setDeviceWarehouses.mockResolvedValue({
      ok: false,
      code: 'INVALID',
      message: 'Unknown warehouse: ghost',
    });
    mount(<DeviceTable rows={[dev({})]} warehouses={wh} />);
    fireEvent.click(screen.getAllByLabelText('Warehouses for Dock 1')[0]);
    fireEvent.click(
      await screen.findByRole('option', {
        name: 'North DC (Setup incomplete)',
        hidden: true,
      }),
    );
    expect((await screen.findByRole('alert')).textContent).toContain('ghost');
  });
});

describe('DevicesPage', () => {
  it('keeps submit disabled for the reserved id desk', async () => {
    fns.listDevices.mockResolvedValue({ ok: true, devices: [dev({})] });
    fns.listWarehousesAdmin.mockResolvedValue(wh);
    mount(<DevicesPage />);
    await screen.findByText('Dock 1');
    fireEvent.click(screen.getByRole('button', { name: 'Enroll device' }));
    fireEvent.change(await screen.findByLabelText('Device id'), {
      target: { value: 'desk' },
    });
    fireEvent.change(screen.getByLabelText('Label'), {
      target: { value: 'Desk' },
    });
    expect(
      (
        screen.getByRole('button', {
          name: 'Enroll',
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(true);
    expect(screen.getByText('Reserved device id')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Device id'), {
      target: { value: 'dock-2' },
    });
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Enroll',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  });

  it('shows the error Alert only when there is no data', async () => {
    fns.listDevices.mockRejectedValue(new Error('boom'));
    fns.listWarehousesAdmin.mockResolvedValue(wh);
    mount(<DevicesPage />);
    expect((await screen.findByRole('alert')).textContent).toContain('boom');
  });
});
