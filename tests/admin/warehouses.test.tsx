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
import type { AdminWarehouseRow } from '#/server/admin/warehouses.server';

const fns = vi.hoisted(() => ({
  listWarehousesAdmin: vi.fn(),
  createWarehouse: vi.fn(),
  finishWarehouseSetup: vi.fn(),
  renameWarehouse: vi.fn(),
}));
vi.mock('#/server/admin/warehouses.fn', () => fns);
vi.mock('@tanstack/react-router', async (orig) => ({
  ...(await orig<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    params,
  }: {
    children: ReactNode;
    params?: { warehouseId: string };
  }) => (
    <a href={`/admin/warehouses/${params?.warehouseId}/locations`}>
      {children}
    </a>
  ),
}));

import { WarehouseForm } from '#/admin/components/WarehouseForm';
import { WarehouseTable } from '#/admin/components/WarehouseTable';
import { WarehousesPage } from '#/routes/admin/warehouses.index';

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

const row = (over: Partial<AdminWarehouseRow>): AdminWarehouseRow => ({
  id: 'wh1',
  name: 'Main',
  tursoDbName: 'fi-wh1',
  schemaVersion: 1,
  status: 'READY',
  deviceCount: 2,
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

describe('WarehouseTable', () => {
  it('shows a badge and the right action per status', () => {
    mount(
      <WarehouseTable
        rows={[
          row({ id: 'a', name: 'A' }),
          row({ id: 'b', name: 'B', status: 'SETUP_INCOMPLETE' }),
          row({ id: 'c', name: 'C', status: 'NEEDS_MIGRATION' }),
        ]}
      />,
    );
    expect(screen.getByText('Ready')).toBeTruthy();
    expect(screen.getByText('Setup incomplete')).toBeTruthy();
    expect(screen.getByText('Needs migration')).toBeTruthy();
    expect(screen.getAllByText('Finish setup')).toHaveLength(1);
    expect(screen.getAllByText('Run migrations')).toHaveLength(1);
    expect(screen.getAllByText('Locations')).toHaveLength(3);
  });

  it('Finish setup calls the fn and invalidates the list', async () => {
    fns.finishWarehouseSetup.mockResolvedValue({ ok: true, status: 'READY' });
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    mount(
      <WarehouseTable rows={[row({ status: 'SETUP_INCOMPLETE' })]} />,
      client,
    );
    fireEvent.click(screen.getByText('Finish setup'));
    await waitFor(() =>
      expect(fns.finishWarehouseSetup).toHaveBeenCalledWith(
        expect.objectContaining({ data: { id: 'wh1' } }),
      ),
    );
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ['admin', 'warehouses'] }),
    );
  });

  it('shows a failed setup inside the row', async () => {
    fns.finishWarehouseSetup.mockResolvedValue({
      ok: false,
      code: 'NOT_READY',
      message: 'Setup incomplete: boom',
    });
    mount(<WarehouseTable rows={[row({ status: 'SETUP_INCOMPLETE' })]} />);
    fireEvent.click(screen.getByText('Finish setup'));
    expect((await screen.findByRole('alert')).textContent).toContain('boom');
  });

  it('renames with the client-safe schema', async () => {
    fns.renameWarehouse.mockResolvedValue({ ok: true });
    mount(<WarehouseTable rows={[row({})]} />);
    fireEvent.click(screen.getByLabelText('Rename wh1'));
    const input = screen.getByLabelText('Name for wh1');
    fireEvent.change(input, { target: { value: '   ' } });
    expect(
      (screen.getByText('Save').closest('button') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(input, { target: { value: ' Renamed ' } });
    fireEvent.click(screen.getByText('Save'));
    await waitFor(() =>
      expect(fns.renameWarehouse).toHaveBeenCalledWith(
        expect.objectContaining({ data: { id: 'wh1', name: 'Renamed' } }),
      ),
    );
  });
});

describe('WarehouseForm', () => {
  it('keeps submit disabled for an invalid id and shows the pattern hint', () => {
    mount(<WarehouseForm onCreated={() => {}} />);
    expect(
      screen.getByText(/Lowercase letters, digits and dashes/),
    ).toBeTruthy();
    const btn = screen.getByText('Create warehouse').closest('button');
    fireEvent.change(screen.getByLabelText(/Warehouse id/), {
      target: { value: 'Bad Id' },
    });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Name' },
    });
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(screen.getByLabelText(/Warehouse id/), {
      target: { value: 'good-id' },
    });
    expect((btn as HTMLButtonElement).disabled).toBe(false);
  });

  it('shows NOT_READY in a red alert, keeps the form and refreshes the list', async () => {
    fns.createWarehouse.mockResolvedValue({
      ok: false,
      code: 'NOT_READY',
      message: 'Setup incomplete: no db',
    });
    const onCreated = vi.fn();
    const client = new QueryClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    mount(<WarehouseForm onCreated={onCreated} />, client);
    fireEvent.change(screen.getByLabelText(/Warehouse id/), {
      target: { value: 'wh9' },
    });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Nine' },
    });
    fireEvent.click(screen.getByText('Create warehouse'));
    expect((await screen.findByRole('alert')).textContent).toContain('no db');
    expect(onCreated).not.toHaveBeenCalled();
    expect(spy).toHaveBeenCalledWith({ queryKey: ['admin', 'warehouses'] });
    expect((screen.getByLabelText('Name') as HTMLInputElement).value).toBe(
      'Nine',
    );
  });
});

describe('WarehousesPage', () => {
  it('lists rows; a NOT_READY-created row offers Finish setup', async () => {
    fns.listWarehousesAdmin.mockResolvedValue([
      row({ id: 'wh9', name: 'Nine', status: 'SETUP_INCOMPLETE' }),
    ]);
    mount(<WarehousesPage />);
    expect(await screen.findByText('Finish setup')).toBeTruthy();
  });

  it('keeps data and shows a refresh note when a poll fails', async () => {
    fns.listWarehousesAdmin.mockResolvedValueOnce([row({})]);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    mount(<WarehousesPage />, client);
    await screen.findByText('Main');
    fns.listWarehousesAdmin.mockRejectedValue(new Error('down'));
    await client.refetchQueries({ queryKey: ['admin', 'warehouses'] });
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText('Main')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
