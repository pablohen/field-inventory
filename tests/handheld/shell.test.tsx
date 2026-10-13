// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
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
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  AttentionView,
  exportFilename,
} from '#/handheld/components/AttentionView';
import { ScanInput } from '#/handheld/components/ScanInput';
import { StatusPill } from '#/handheld/components/StatusPill';
import { StockView } from '#/handheld/components/StockView';
import { HandheldContext, type HandheldValue } from '#/handheld/context';
import { initialSyncState, STALE_WARNING_MS } from '#/handheld/sync-loop';

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
afterEach(cleanup);

type Call = (method: string, ...args: unknown[]) => Promise<unknown>;

function fakeValue(over: Partial<HandheldValue> & { call?: Call } = {}) {
  const call = over.call ?? vi.fn(async () => undefined);
  const { call: _c, ...rest } = over;
  const value: HandheldValue = {
    backend: { role: 'leader', onRoleChange: () => () => {}, call } as never,
    syncState: { ...initialSyncState },
    session: null,
    banner: null,
    setBanner() {},
    ...rest,
  };
  return { value, call };
}

async function mount(ui: ReactNode, value: HandheldValue) {
  const router = createRouter({
    routeTree: createRootRoute({ component: () => ui }),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false, networkMode: 'always' } },
  });
  render(
    <MantineProvider>
      <QueryClientProvider client={qc}>
        <HandheldContext.Provider value={value}>
          <RouterProvider router={router} />
        </HandheldContext.Provider>
      </QueryClientProvider>
    </MantineProvider>,
  );
  await waitFor(() => expect(document.body.textContent).not.toBe(''));
}

describe('ScanInput', () => {
  it('calls onScan once per Enter with the trimmed value, clears and refocuses', () => {
    const onScan = vi.fn();
    render(
      <MantineProvider>
        <HandheldContext.Provider value={fakeValue().value}>
          <ScanInput onScan={onScan} label="Scan" />
        </HandheldContext.Provider>
      </MantineProvider>,
    );
    const input = screen.getByLabelText('Scan') as HTMLInputElement;
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: '  ABC123  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onScan).toHaveBeenCalledTimes(1);
    expect(onScan).toHaveBeenCalledWith('ABC123');
    expect(input.value).toBe('');
    input.blur();
    fireEvent.change(input, { target: { value: 'X' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onScan).toHaveBeenCalledTimes(2);
    expect(document.activeElement).toBe(input);
  });

  it('is disabled until the backend is ready, then enabled and focused', () => {
    const onScan = vi.fn();
    const ui = (value: HandheldValue) => (
      <MantineProvider>
        <HandheldContext.Provider value={value}>
          <ScanInput onScan={onScan} label="Scan" />
        </HandheldContext.Provider>
      </MantineProvider>
    );
    const { rerender } = render(ui(fakeValue({ backend: null }).value));
    const input = screen.getByLabelText('Scan') as HTMLInputElement;
    expect((input as HTMLInputElement).disabled).toBe(true);
    expect(input.placeholder).toBe('Starting…');
    fireEvent.change(input, { target: { value: 'ABC' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onScan).not.toHaveBeenCalled();

    rerender(ui(fakeValue().value));
    const ready = screen.getByLabelText('Scan') as HTMLInputElement;
    expect(ready.disabled).toBe(false);
    expect(document.activeElement).toBe(ready);
  });

  it('ignores empty and whitespace-only values', () => {
    const onScan = vi.fn();
    render(
      <MantineProvider>
        <HandheldContext.Provider value={fakeValue().value}>
          <ScanInput onScan={onScan} label="Scan" />
        </HandheldContext.Provider>
      </MantineProvider>,
    );
    const input = screen.getByLabelText('Scan');
    fireEvent.keyDown(input, { key: 'Enter' });
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onScan).not.toHaveBeenCalled();
  });
});

describe('StatusPill', () => {
  const T0 = Date.parse('2026-01-01T00:00:00Z');
  const pill = (
    patch: Partial<HandheldValue['syncState'] & object>,
    now: number,
  ) =>
    mount(
      <StatusPill now={now} />,
      fakeValue({
        syncState: {
          ...initialSyncState,
          lastPullAt: new Date(T0).toISOString(),
          ...patch,
        },
      }).value,
    );

  it('is stale just past STALE_WARNING_MS', async () => {
    await pill({}, T0 + STALE_WARNING_MS + 1);
    expect(await screen.findByText(/stale/i)).toBeTruthy();
  });

  it('is not stale just before STALE_WARNING_MS', async () => {
    await pill({}, T0 + STALE_WARNING_MS - 1);
    await screen.findByText('Online');
    expect(screen.queryByText(/stale/i)).toBeNull();
  });

  it('shows Sign in to sync for needs_sign_in', async () => {
    await pill({ phase: 'needs_sign_in' }, T0);
    expect(await screen.findByText('Sign in to sync')).toBeTruthy();
  });

  it.each([
    ['device_revoked', 'Device revoked', '/h/attention'],
    ['device_unknown', 'Device not enrolled', '/h/attention'],
  ] as const)(
    '%s shows a badge linking to attention',
    async (phase, text, href) => {
      await pill({ phase }, T0);
      const a = (await screen.findByText(text)).closest('a');
      expect(a?.getAttribute('href')).toBe(href);
    },
  );

  it.each([
    [{}, 'synced'],
    [{ pendingCount: 2 }, 'pending'],
    [{ attentionCount: 1, pendingCount: 2 }, 'attention'],
    [{ phase: 'device_revoked' }, 'attention'],
    [{ phase: 'device_unknown' }, 'attention'],
  ] as const)('exposes data-status for %j', async (patch, status) => {
    await pill({ ...patch }, T0);
    await screen.findByText('Sync now');
    expect(
      document.querySelector('[data-status]')?.getAttribute('data-status'),
    ).toBe(status);
  });

  it('shows Update required for update_required', async () => {
    await pill({ phase: 'update_required' }, T0);
    expect(await screen.findByText('Update required')).toBeTruthy();
  });

  it('shows pending and attention counts, attention links to /h/attention', async () => {
    await pill({ pendingCount: 3, attentionCount: 2 }, T0);
    expect(await screen.findByText('3 pending')).toBeTruthy();
    const a = (await screen.findByText('2 need attention')).closest('a');
    expect(a?.getAttribute('href')).toBe('/h/attention');
  });

  it('shows Starting… while the backend is null, then Sync now calls syncNow', async () => {
    await mount(<StatusPill now={T0} />, fakeValue({ backend: null }).value);
    expect(await screen.findByText('Starting…')).toBeTruthy();
    cleanup();
    const { value, call } = fakeValue({
      call: vi.fn(async () => initialSyncState),
    });
    await mount(<StatusPill now={T0} />, value);
    fireEvent.click(await screen.findByText('Sync now'));
    expect(call).toHaveBeenCalledWith('syncNow');
  });
});

describe('AttentionView', () => {
  const rows = [
    {
      id: 'r1',
      warehouseId: 'w1',
      status: 'needs_attention',
      lastError: 'NEGATIVE_STOCK',
      createdAt: '2026-01-01T00:00:00Z',
      input: { type: 'PICK' },
    },
    {
      id: 'r2',
      warehouseId: 'w1',
      status: 'needs_attention',
      lastError: 'CORRUPT_ROW',
      createdAt: '2026-01-01T00:00:00Z',
      input: { raw: '{' },
      corrupt: true,
    },
  ];
  const call = () =>
    vi.fn(async (m: string) => (m === 'listOutbox' ? rows : undefined));

  it('lists rows (corrupt as Unreadable record) and discards after confirm', async () => {
    const c = call();
    await mount(<AttentionView />, fakeValue({ call: c }).value);
    expect(await screen.findByText('Unreadable record')).toBeTruthy();
    expect(screen.getByText('NEGATIVE_STOCK')).toBeTruthy();
    fireEvent.click(screen.getAllByText('Discard')[0] as HTMLElement);
    expect(c).not.toHaveBeenCalledWith('discardOutbox', expect.anything());
    fireEvent.click(await screen.findByText('Confirm discard'));
    await waitFor(() => expect(c).toHaveBeenCalledWith('discardOutbox', 'r1'));
  });

  it('shows Export outbox only when device_revoked', async () => {
    await mount(<AttentionView />, fakeValue({ call: call() }).value);
    await screen.findByText('Unreadable record');
    expect(screen.queryByText('Export outbox')).toBeNull();
    cleanup();
    await mount(
      <AttentionView />,
      fakeValue({
        call: call(),
        syncState: { ...initialSyncState, phase: 'device_revoked' },
      }).value,
    );
    expect(await screen.findByText('Export outbox')).toBeTruthy();
  });

  it('shows Export and read-only pending rows when device_unknown', async () => {
    const pending = {
      id: 'p1',
      warehouseId: 'w1',
      status: 'pending',
      lastError: null,
      createdAt: '2026-01-01T00:00:00Z',
      input: { type: 'MOVE' },
    };
    const c = vi.fn(async (m: string, f?: { status?: string }) =>
      m === 'listOutbox'
        ? f?.status === 'pending'
          ? [pending]
          : []
        : undefined,
    );
    await mount(
      <AttentionView />,
      fakeValue({
        call: c as never,
        syncState: { ...initialSyncState, phase: 'device_unknown' },
      }).value,
    );
    expect(await screen.findByText('Export outbox')).toBeTruthy();
    expect(await screen.findByText('MOVE in w1')).toBeTruthy();
    expect(screen.getAllByText('Not yet synced').length).toBeGreaterThan(0);
    expect(screen.queryByText('Discard')).toBeNull();
  });

  it('shows an error when export fails', async () => {
    const c = vi.fn(async (m: string) => {
      if (m === 'exportOutbox') throw new Error('boom');
      return [];
    });
    await mount(
      <AttentionView />,
      fakeValue({
        call: c as never,
        syncState: { ...initialSyncState, phase: 'device_revoked' },
      }).value,
    );
    fireEvent.click(await screen.findByText('Export outbox'));
    expect(await screen.findByText(/Could not export: boom/)).toBeTruthy();
  });

  it('shows the discard error outside the modal', async () => {
    const c = vi.fn(async (m: string) => {
      if (m === 'discardOutbox') throw new Error('nope');
      return rows;
    });
    await mount(<AttentionView />, fakeValue({ call: c as never }).value);
    fireEvent.click((await screen.findAllByText('Discard'))[0] as HTMLElement);
    fireEvent.click(await screen.findByText('Confirm discard'));
    expect(await screen.findByText(/Could not discard: nope/)).toBeTruthy();
  });

  it('names the export file by device and date', () => {
    expect(exportFilename('dev1', new Date('2026-03-04T10:00:00Z'))).toBe(
      'outbox-dev1-2026-03-04.json',
    );
  });
});

describe('StockView', () => {
  it('shows Pending only on rows with pendingDelta !== 0', async () => {
    const c = vi.fn(async () => [
      { skuId: 'sku-a', locationId: 'l1', qty: 5, pendingDelta: 2 },
      { skuId: 'sku-b', locationId: 'l1', qty: 7, pendingDelta: 0 },
    ]);
    await mount(<StockView wh="w1" />, fakeValue({ call: c }).value);
    await screen.findByText('sku-a');
    expect(c).toHaveBeenCalledWith('displayedStock', 'w1', undefined);
    const rowA = screen.getByText('sku-a').closest('tr') as HTMLElement;
    const rowB = screen.getByText('sku-b').closest('tr') as HTMLElement;
    expect(rowA.textContent).toContain('Pending');
    expect(rowB.textContent).not.toContain('Pending');
    expect(screen.getAllByText('Pending')).toHaveLength(1);
  });
});
