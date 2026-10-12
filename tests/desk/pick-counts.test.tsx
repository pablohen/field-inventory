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
import { scopeSummary } from '#/desk/count-scope';
import type { CountTaskRow } from '#/server/desk/count-tasks.server';
import type { LocationRow } from '#/server/desk/locations.server';
import type { PickListRow } from '#/server/desk/pick-lists.server';

import { deskFetch } from '#/shared/checked-fetch';

const fns = vi.hoisted(() => ({
  suggestPickList: vi.fn(),
  createPickList: vi.fn(),
  listPickLists: vi.fn(),
  assignPickList: vi.fn(),
  closePickList: vi.fn(),
  createCountTask: vi.fn(),
  listCountTasks: vi.fn(),
  assignCountTask: vi.fn(),
  closeCountTask: vi.fn(),
  listWorkers: vi.fn(),
  listLocations: vi.fn(),
  getStock: vi.fn(),
}));
vi.mock('#/server/desk/pick-lists.fn', () => ({
  suggestPickList: fns.suggestPickList,
  createPickList: fns.createPickList,
  listPickLists: fns.listPickLists,
  assignPickList: fns.assignPickList,
  closePickList: fns.closePickList,
}));
vi.mock('#/server/desk/count-tasks.fn', () => ({
  createCountTask: fns.createCountTask,
  listCountTasks: fns.listCountTasks,
  assignCountTask: fns.assignCountTask,
  closeCountTask: fns.closeCountTask,
  listWorkers: fns.listWorkers,
}));
vi.mock('#/server/desk/locations.fn', () => ({
  listLocations: fns.listLocations,
}));
vi.mock('#/server/desk/stock.fn', () => ({
  getStock: fns.getStock,
  getLedger: vi.fn(),
  listReasonCodes: vi.fn(),
}));

import { CountTaskForm } from '#/desk/components/CountTaskForm';
import { CountTaskTable } from '#/desk/components/CountTaskTable';
import { PickListForm } from '#/desk/components/PickListForm';
import { PickListTable } from '#/desk/components/PickListTable';
import { CountsPage } from '#/routes/w/$warehouseId/counts';
import { PickListsPage } from '#/routes/w/$warehouseId/pick-lists';

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

const WH = 'wh1';
const WORKERS = [{ id: 'w1', name: 'Wendy' }];
const LOCATIONS: LocationRow[] = [
  { id: 'L1', code: 'A-01', zone: 'A', active: true },
  { id: 'L2', code: 'A-02', zone: 'A', active: true },
  { id: 'L3', code: 'B-01', zone: 'B', active: false },
];

function mount(ui: ReactNode, client = new QueryClient()) {
  render(
    <QueryClientProvider client={client}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );
  return client;
}

/** The text input behind a Mantine field (its listbox shares the label). */
function field(label: string | RegExp): HTMLElement {
  const el = screen
    .getAllByLabelText(label)
    .find((e) => e.tagName === 'INPUT' && e.getAttribute('type') !== 'radio');
  if (!el) throw new Error(`No input labelled ${String(label)}`);
  return el;
}

async function choose(label: string | RegExp, option: string) {
  fireEvent.click(field(label));
  // Other fields may list the same option; the first match is the field just opened.
  const opts = await screen.findAllByRole('option', {
    name: option,
    hidden: true,
  });
  fireEvent.click(opts[0] as HTMLElement);
}

describe('scopeSummary', () => {
  it('describes every scope shape', () => {
    expect(scopeSummary({ zone: 'A' })).toBe('Zone A');
    expect(scopeSummary({ locations: ['a', 'b', 'c'] })).toBe('3 bins');
    expect(scopeSummary({ skus: ['a', 'b'] })).toBe('2 SKUs');
    expect(scopeSummary({ locations: ['a'], skus: ['x', 'y'] })).toBe(
      '1 bins · 2 SKUs',
    );
    expect(scopeSummary(null, true)).toBe('Unreadable scope');
    expect(scopeSummary({ nope: 1 })).toBe('Unreadable scope');
  });
});

describe('PickListForm', () => {
  function stockFor(rows: Record<string, { id: string; code: string }[]>) {
    fns.getStock.mockImplementation(
      async ({ data }: { data: { filters: { skuId: string } } }) => ({
        ok: true,
        rows: (rows[data.filters.skuId] ?? []).map((l) => ({
          skuId: data.filters.skuId,
          sku: data.filters.skuId,
          name: 'n',
          locationId: l.id,
          locationCode: l.code,
          qty: 5,
        })),
      }),
    );
  }

  async function suggestFlow() {
    fireEvent.change(screen.getByLabelText('SKU 1'), {
      target: { value: 'P1' },
    });
    fireEvent.change(screen.getByLabelText('Qty 1'), {
      target: { value: '10' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Suggest bins' }));
    await screen.findAllByLabelText('Bin for line 1');
  }

  it('keeps Create disabled until every line has a bin, and shows shortfalls', async () => {
    stockFor({ P1: [{ id: 'L2', code: 'A-02' }] });
    fns.suggestPickList.mockResolvedValue({
      ok: true,
      lines: [
        { skuId: 'P1', locationId: null, qty: 6 },
        { skuId: 'P1', locationId: 'L1', qty: 4 },
      ],
      shortfalls: [{ skuId: 'P1', missing: 6 }],
    });
    fns.createPickList.mockResolvedValue({ ok: true, id: 'pl1' });
    const onCreated = vi.fn();
    mount(
      <PickListForm
        warehouseId={WH}
        workers={WORKERS}
        locations={LOCATIONS}
        onCreated={onCreated}
      />,
    );
    await suggestFlow();

    expect(fns.suggestPickList).toHaveBeenCalledWith({
      fetch: deskFetch,
      data: { warehouseId: WH, requests: [{ skuId: 'P1', qty: 10 }] },
    });
    expect(screen.getByText('Short by 6 for P1')).toBeTruthy();
    const create = screen.getByRole('button', {
      name: 'Create pick list',
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);

    // The SKU's stocked bin is offered for the unbinned line.
    await waitFor(() => expect(fns.getStock).toHaveBeenCalled());
    await choose('Bin for line 1', 'A-02 (5 on hand)');
    await waitFor(() => expect(create.disabled).toBe(false));
    // Qty 6 exceeds the 5 on hand: a warning, not a block.
    expect(screen.getByText('Only 5 on hand in A-02')).toBeTruthy();

    fireEvent.click(create);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(fns.createPickList).toHaveBeenCalledWith({
      fetch: deskFetch,
      data: {
        warehouseId: WH,
        lines: [
          { skuId: 'P1', locationId: 'L2', qty: 6 },
          { skuId: 'P1', locationId: 'L1', qty: 4 },
        ],
      },
    });
  });

  it('offers all active bins when the SKU has no stock', async () => {
    stockFor({});
    fns.suggestPickList.mockResolvedValue({
      ok: true,
      lines: [{ skuId: 'P1', locationId: null, qty: 10 }],
      shortfalls: [{ skuId: 'P1', missing: 10 }],
    });
    mount(
      <PickListForm
        warehouseId={WH}
        workers={WORKERS}
        locations={LOCATIONS}
        onCreated={vi.fn()}
      />,
    );
    await suggestFlow();
    await waitFor(() => expect(fns.getStock).toHaveBeenCalled());
    fireEvent.click(field('Bin for line 1'));
    expect(
      await screen.findByRole('option', { name: 'A-01', hidden: true }),
    ).toBeTruthy();
    expect(
      screen.getByRole('option', { name: 'A-02', hidden: true }),
    ).toBeTruthy();
    expect(
      screen.queryByRole('option', { name: 'B-01', hidden: true }),
    ).toBeNull();
  });

  it('falls back to all active bins with a note when stock fails to load', async () => {
    fns.getStock.mockRejectedValue(new Error('stock down'));
    fns.suggestPickList.mockResolvedValue({
      ok: true,
      lines: [{ skuId: 'P1', locationId: null, qty: 10 }],
      shortfalls: [{ skuId: 'P1', missing: 10 }],
    });
    fns.createPickList.mockResolvedValue({ ok: true, id: 'pl1' });
    mount(
      <PickListForm
        warehouseId={WH}
        workers={WORKERS}
        locations={LOCATIONS}
        onCreated={vi.fn()}
      />,
    );
    await suggestFlow();
    expect(
      await screen.findByText("Couldn't load stock for P1; showing all bins."),
    ).toBeTruthy();
    await choose('Bin for line 1', 'A-01');
    await waitFor(() =>
      expect(
        (
          screen.getByRole('button', {
            name: 'Create pick list',
          }) as HTMLButtonElement
        ).disabled,
      ).toBe(false),
    );
  });

  it('falls back the same way when stock returns a DeskError', async () => {
    fns.getStock.mockResolvedValue({
      ok: false,
      code: 'NOT_READY',
      message: 'Warehouse database is not ready',
    });
    fns.suggestPickList.mockResolvedValue({
      ok: true,
      lines: [{ skuId: 'P1', locationId: null, qty: 1 }],
      shortfalls: [],
    });
    mount(
      <PickListForm
        warehouseId={WH}
        workers={WORKERS}
        locations={LOCATIONS}
        onCreated={vi.fn()}
      />,
    );
    await suggestFlow();
    expect(
      await screen.findByText("Couldn't load stock for P1; showing all bins."),
    ).toBeTruthy();
    fireEvent.click(field('Bin for line 1'));
    expect(
      (await screen.findAllByRole('option', { name: 'A-02', hidden: true }))
        .length,
    ).toBeGreaterThan(0);
  });

  it('shows an INVALID create result in the form and keeps its state', async () => {
    stockFor({ P1: [{ id: 'L1', code: 'A-01' }] });
    fns.suggestPickList.mockResolvedValue({
      ok: true,
      lines: [{ skuId: 'P1', locationId: 'L1', qty: 10 }],
      shortfalls: [],
    });
    fns.createPickList.mockResolvedValue({
      ok: false,
      code: 'INVALID',
      message: 'Line 1: location L1 is inactive',
    });
    const onCreated = vi.fn();
    mount(
      <PickListForm
        warehouseId={WH}
        workers={WORKERS}
        locations={LOCATIONS}
        onCreated={onCreated}
      />,
    );
    await suggestFlow();
    fireEvent.click(screen.getByRole('button', { name: 'Create pick list' }));
    expect(
      await screen.findByText('Line 1: location L1 is inactive'),
    ).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
    expect(field('Bin for line 1')).toBeTruthy();
  });
});

describe('CountTaskForm', () => {
  it('posts { zone } for the Zone scope', async () => {
    fns.createCountTask.mockResolvedValue({ ok: true, id: 'c1' });
    const onCreated = vi.fn();
    mount(
      <CountTaskForm
        warehouseId={WH}
        workers={WORKERS}
        locations={LOCATIONS}
        onCreated={onCreated}
      />,
    );
    const create = screen.getByRole('button', {
      name: 'Create count task',
    }) as HTMLButtonElement;
    expect(create.disabled).toBe(true);
    fireEvent.click(screen.getByRole('radio', { name: 'Zone' }));
    await choose('Zone', 'A');
    await waitFor(() => expect(create.disabled).toBe(false));
    fireEvent.click(create);
    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect(fns.createCountTask).toHaveBeenCalledWith({
      fetch: deskFetch,
      data: { warehouseId: WH, scope: { zone: 'A' } },
    });
  });

  it('posts { locations } for the Bins scope', async () => {
    fns.createCountTask.mockResolvedValue({ ok: true, id: 'c1' });
    mount(
      <CountTaskForm
        warehouseId={WH}
        workers={WORKERS}
        locations={LOCATIONS}
        onCreated={vi.fn()}
      />,
    );
    fireEvent.click(field('Bins'));
    fireEvent.click(
      await screen.findByRole('option', { name: 'A-01', hidden: true }),
    );
    fireEvent.click(
      await screen.findByRole('option', {
        name: 'B-01 (inactive)',
        hidden: true,
      }),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Create count task' }));
    await waitFor(() =>
      expect(fns.createCountTask).toHaveBeenCalledWith({
        fetch: deskFetch,
        data: { warehouseId: WH, scope: { locations: ['L1', 'L3'] } },
      }),
    );
  });

  it('shows an INVALID result inside the drawer without closing it', async () => {
    fns.createCountTask.mockResolvedValue({
      ok: false,
      code: 'INVALID',
      message: 'Zone A has no locations',
    });
    const onCreated = vi.fn();
    mount(
      <CountTaskForm
        warehouseId={WH}
        workers={WORKERS}
        locations={LOCATIONS}
        onCreated={onCreated}
      />,
    );
    await choose('Bins', 'A-01');
    fireEvent.click(screen.getByRole('button', { name: 'Create count task' }));
    expect(await screen.findByText('Zone A has no locations')).toBeTruthy();
    expect(onCreated).not.toHaveBeenCalled();
  });
});

const pickRow: PickListRow = {
  id: 'pl-12345678',
  status: 'OPEN',
  createdBy: 'sup',
  createdAt: '2026-03-01T12:00:00.000Z',
  assignedUserId: null,
  assignedUserName: null,
  lines: [
    { id: 'a', skuId: 'P1', locationId: 'L1', qtyRequested: 5, pickedQty: 2 },
    { id: 'b', skuId: 'P2', locationId: 'L1', qtyRequested: 3, pickedQty: 0 },
  ],
};

describe('PickListTable', () => {
  it('shows picked/requested and Close invalidates the list key', async () => {
    fns.closePickList.mockResolvedValue({ ok: true });
    const client = mount(
      <PickListTable warehouseId={WH} rows={[pickRow]} workers={WORKERS} />,
    );
    const spy = vi.spyOn(client, 'invalidateQueries');
    expect(screen.getByText('2/8')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(fns.closePickList).toHaveBeenCalledWith({
        fetch: deskFetch,
        data: { warehouseId: WH, pickListId: 'pl-12345678' },
      }),
    );
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({
        queryKey: ['desk', WH, 'pick-lists'],
      }),
    );
  });

  it('disables Close while pending (no double submit)', async () => {
    let release: (v: { ok: true }) => void = () => {};
    fns.closePickList.mockReturnValue(
      new Promise((r) => {
        release = r;
      }),
    );
    mount(
      <PickListTable warehouseId={WH} rows={[pickRow]} workers={WORKERS} />,
    );
    const btn = screen.getByRole('button', { name: 'Close' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    expect(fns.closePickList).toHaveBeenCalledTimes(1);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    release({ ok: true });
  });

  it('shows a NOT_FOUND result in the row', async () => {
    fns.closePickList.mockResolvedValue({
      ok: false,
      code: 'NOT_FOUND',
      message: 'Pick list not found',
    });
    mount(
      <PickListTable warehouseId={WH} rows={[pickRow]} workers={WORKERS} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(await screen.findByText('Pick list not found')).toBeTruthy();
  });

  it('assigns a worker', async () => {
    fns.assignPickList.mockResolvedValue({ ok: true });
    mount(
      <PickListTable warehouseId={WH} rows={[pickRow]} workers={WORKERS} />,
    );
    await choose(/Assignee for/, 'Wendy');
    await waitFor(() =>
      expect(fns.assignPickList).toHaveBeenCalledWith({
        fetch: deskFetch,
        data: {
          warehouseId: WH,
          pickListId: 'pl-12345678',
          assignedUserId: 'w1',
        },
      }),
    );
  });
});

const taskRows: CountTaskRow[] = [
  {
    id: 'ct-1',
    status: 'OPEN',
    scope: { zone: 'A' },
    assignedUserId: null,
    assignedUserName: null,
    countsRecorded: 3,
  },
  {
    id: 'ct-2',
    status: 'OPEN',
    scope: null,
    malformed: true,
    assignedUserId: 'w1',
    assignedUserName: 'Wendy',
    countsRecorded: 0,
  },
];

describe('CountTaskTable', () => {
  it('renders scope summaries and counts recorded', () => {
    mount(
      <CountTaskTable warehouseId={WH} rows={taskRows} workers={WORKERS} />,
    );
    expect(screen.getByText('Zone A')).toBeTruthy();
    expect(screen.getByText('Unreadable scope')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('Close calls the close fn and invalidates the list key', async () => {
    fns.closeCountTask.mockResolvedValue({ ok: true });
    const client = mount(
      <CountTaskTable
        warehouseId={WH}
        rows={[taskRows[0] as CountTaskRow]}
        workers={WORKERS}
      />,
    );
    const spy = vi.spyOn(client, 'invalidateQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() =>
      expect(fns.closeCountTask).toHaveBeenCalledWith({
        fetch: deskFetch,
        data: { warehouseId: WH, taskId: 'ct-1' },
      }),
    );
    await waitFor(() =>
      expect(spy).toHaveBeenCalledWith({ queryKey: ['desk', WH, 'counts'] }),
    );
  });
});

describe('failed pickers', () => {
  it('shows inline alerts when bins or workers fail to load', async () => {
    fns.listWorkers.mockRejectedValue(new Error('x'));
    fns.listLocations.mockRejectedValue(new Error('y'));
    fns.listCountTasks.mockResolvedValue({ ok: true, tasks: [] });
    mount(
      <CountsPage warehouseId={WH} />,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );
    expect(await screen.findByText("Couldn't load workers")).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New count task' }));
    expect(await screen.findByText("Couldn't load bins")).toBeTruthy();
    expect(screen.getAllByText("Couldn't load workers").length).toBe(2);
  });
});

describe('pages (R5)', () => {
  it('keeps data and the open drawer when a poll fails', async () => {
    fns.listWorkers.mockResolvedValue(WORKERS);
    fns.listLocations.mockResolvedValue({ ok: true, locations: LOCATIONS });
    fns.listPickLists.mockResolvedValueOnce({ ok: true, lists: [pickRow] });
    const client = mount(
      <PickListsPage warehouseId={WH} />,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );
    expect(await screen.findByText('2/8')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'New pick list' }));
    fireEvent.change(await screen.findByLabelText('SKU 1'), {
      target: { value: 'P9' },
    });

    fns.listPickLists.mockRejectedValue(new Error('boom'));
    await client.refetchQueries({ queryKey: ['desk', WH, 'pick-lists'] });
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText('2/8')).toBeTruthy();
    expect((screen.getByLabelText('SKU 1') as HTMLInputElement).value).toBe(
      'P9',
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('counts page shows an error alert only without data', async () => {
    fns.listWorkers.mockResolvedValue(WORKERS);
    fns.listLocations.mockResolvedValue({ ok: true, locations: LOCATIONS });
    fns.listCountTasks.mockRejectedValue(new Error('down'));
    mount(
      <CountsPage warehouseId={WH} />,
      new QueryClient({ defaultOptions: { queries: { retry: false } } }),
    );
    expect(await screen.findByText('down')).toBeTruthy();
  });
});
