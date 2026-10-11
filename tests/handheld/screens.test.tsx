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
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { MovementInput } from '#/domain/schemas';
import { ScreenFrame } from '#/handheld/components/ScreenFrame';
import { HandheldContext, type HandheldValue } from '#/handheld/context';
import { initialSyncState } from '#/handheld/sync-loop';
import { AdjustFlow } from '../../src/routes/h/$wh.adjust';
import { CountFlow } from '../../src/routes/h/$wh.count';
import { MoveFlow } from '../../src/routes/h/$wh.move';
import { PickFlow } from '../../src/routes/h/$wh.pick';
import { TransferInFlow } from '../../src/routes/h/$wh.transfer-in';

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

const SESSION = {
  userId: 'u1',
  name: 'Ann',
  role: 'OPERATOR',
  deviceId: 'dev-session',
  expiresAt: '2020-01-01T00:00:00.000Z', // expired: still records
};

const LOCS: Record<string, { id: string; code: string; active: boolean }> = {
  'BIN-A': { id: 'locA', code: 'BIN-A', active: true },
  'BIN-B': { id: 'locB', code: 'BIN-B', active: true },
  'BIN-OFF': { id: 'locOff', code: 'BIN-OFF', active: false },
};
const PRODUCTS: Record<string, { id: string; sku: string; name: string }> = {
  WIDGET: { id: 'sku1', sku: 'WIDGET', name: 'Widget' },
  GADGET: { id: 'sku2', sku: 'GADGET', name: 'Gadget' },
};

type Data = {
  stock?: {
    skuId: string;
    locationId: string;
    qty: number;
    pendingDelta: number;
  }[];
  countTasks?: { id: string; scope: unknown; status: string }[];
  pickLists?: unknown[];
  inTransit?: unknown[];
  reasons?: { code: string; label: string }[];
  record?: (input: MovementInput) => Promise<void>;
};

function setup(data: Data = {}) {
  const records: MovementInput[] = [];
  const calls: string[] = [];
  const call = vi.fn(async (method: string, ...args: unknown[]) => {
    calls.push(method);
    switch (method) {
      case 'findLocation':
        return LOCS[args[1] as string] ?? null;
      case 'findProduct':
        return PRODUCTS[args[0] as string] ?? null;
      case 'displayedStock':
        return data.stock ?? [];
      case 'assignedCountTasks':
        return data.countTasks ?? [];
      case 'assignedPickLists':
        return data.pickLists ?? [];
      case 'inTransitTo':
        return data.inTransit ?? [];
      case 'reasonCodes':
        return data.reasons ?? [];
      case 'record':
        records.push(args[0] as MovementInput);
        return data.record?.(args[0] as MovementInput);
      default:
        return undefined;
    }
  });
  const value: HandheldValue = {
    backend: { role: 'leader', onRoleChange: () => () => {}, call } as never,
    syncState: { ...initialSyncState },
    session: null,
    banner: null,
    setBanner() {},
  };
  return { value, call, records, calls };
}

async function mount(ui: ReactNode, value: HandheldValue) {
  const root = createRootRoute({ component: () => ui });
  const router = createRouter({
    routeTree: root.addChildren([
      createRoute({
        getParentRoute: () => root,
        path: '/h/login',
        component: () => <p>login page</p>,
      }),
    ]),
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
  return router;
}

async function scan(label: string, text: string) {
  const input = await screen.findByLabelText(label);
  fireEvent.change(input, { target: { value: text } });
  fireEvent.keyDown(input, { key: 'Enter' });
}

async function setQty(label: string, n: number) {
  const input = await screen.findByLabelText(label);
  fireEvent.change(input, { target: { value: String(n) } });
}

function visibleText() {
  const clone = document.body.cloneNode(true) as HTMLElement;
  for (const el of clone.querySelectorAll('style,script')) el.remove();
  return clone.textContent ?? '';
}

const click = async (name: string) =>
  fireEvent.click(await screen.findByRole('button', { name }));

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem('fi:session', JSON.stringify(SESSION));
  localStorage.setItem('fi:deviceId', 'dev-local');
  localStorage.setItem(
    'fi:replicaConfig',
    JSON.stringify({
      staleWarningMs: 1000,
      replicas: ['catalog', 'w1', 'w2', 'w3'].map((name) => ({
        name,
        dbName: name,
        url: 'x',
        token: 't',
        expiresAt: 'x',
      })),
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('Count', () => {
  it('is blind: never reads displayedStock, shows no number but the entered qty, records one COUNT', async () => {
    const t = setup({
      stock: [{ skuId: 'sku1', locationId: 'locA', qty: 777, pendingDelta: 0 }],
      countTasks: [{ id: 'task-x', scope: {}, status: 'OPEN' }],
    });
    await mount(<CountFlow wh="w1" />, t.value);
    await scan('Scan location', 'BIN-A');
    await scan('Scan product', 'WIDGET');
    await setQty('Counted quantity', 42);
    const text = visibleText();
    expect(text).not.toMatch(/777/);
    // the only number on screen is the user's own entry, inside the input
    expect(text.match(/\d+/g)).toBeNull();
    expect(
      (screen.getByLabelText('Counted quantity') as HTMLInputElement).value,
    ).toBe('42');
    await click('Confirm count');
    await screen.findByText('Recorded');
    expect(t.records).toHaveLength(1);
    expect(t.records[0]).toMatchObject({
      type: 'COUNT',
      warehouseId: 'w1',
      skuId: 'sku1',
      locationId: 'locA',
      qty: 42,
      userId: 'u1',
      deviceId: 'dev-local',
    });
    expect(t.records[0]).not.toHaveProperty('ref');
    expect(t.calls).not.toContain('displayedStock');
    // reset to the first step, refocused
    const next = await screen.findByLabelText('Scan location');
    expect(document.activeElement).toBe(next);
  });

  it('records the chosen count task as ref, and allows a zero count', async () => {
    const t = setup({
      countTasks: [{ id: 'task-x', scope: {}, status: 'OPEN' }],
    });
    await mount(<CountFlow wh="w1" />, t.value);
    fireEvent.change(await screen.findByLabelText('Count task (optional)'), {
      target: { value: 'task-x' },
    });
    await scan('Scan location', 'BIN-A');
    await scan('Scan product', 'WIDGET');
    await setQty('Counted quantity', 0);
    await click('Confirm count');
    await waitFor(() => expect(t.records).toHaveLength(1));
    expect(t.records[0]).toMatchObject({
      type: 'COUNT',
      qty: 0,
      ref: 'task-x',
    });
  });

  it('falls back to the session device id', async () => {
    localStorage.removeItem('fi:deviceId');
    const t = setup();
    await mount(<CountFlow wh="w1" />, t.value);
    await scan('Scan location', 'BIN-A');
    await scan('Scan product', 'WIDGET');
    await setQty('Counted quantity', 1);
    await click('Confirm count');
    await waitFor(() => expect(t.records).toHaveLength(1));
    expect(t.records[0].deviceId).toBe('dev-session');
  });

  it('two rapid Enter presses record once', async () => {
    let release: () => void = () => {};
    const t = setup({ record: () => new Promise<void>((r) => (release = r)) });
    await mount(<CountFlow wh="w1" />, t.value);
    await scan('Scan location', 'BIN-A');
    await scan('Scan product', 'WIDGET');
    await setQty('Counted quantity', 5);
    const qty = await screen.findByLabelText('Counted quantity');
    fireEvent.keyDown(qty, { key: 'Enter' });
    fireEvent.keyDown(qty, { key: 'Enter' });
    await waitFor(() => expect(t.records).toHaveLength(1));
    release();
    await screen.findByText('Recorded');
    expect(t.records).toHaveLength(1);
  });

  it('two rapid clicks record once', async () => {
    let release: () => void = () => {};
    const t = setup({ record: () => new Promise<void>((r) => (release = r)) });
    await mount(<CountFlow wh="w1" />, t.value);
    await scan('Scan location', 'BIN-A');
    await scan('Scan product', 'WIDGET');
    await setQty('Counted quantity', 5);
    const btn = await screen.findByRole('button', { name: 'Confirm count' });
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(t.records).toHaveLength(1));
    release();
    await screen.findByText('Recorded');
    expect(t.records).toHaveLength(1);
  });

  it('keeps the form and shows the error when recording fails, then allows a retry', async () => {
    let fail = true;
    const t = setup({
      record: async () => {
        if (fail) throw new Error('boom');
      },
    });
    await mount(<CountFlow wh="w1" />, t.value);
    await scan('Scan location', 'BIN-A');
    await scan('Scan product', 'WIDGET');
    await setQty('Counted quantity', 5);
    await click('Confirm count');
    await screen.findByText(/boom/);
    expect(screen.getByLabelText('Counted quantity')).toBeTruthy();
    fail = false;
    await click('Confirm count');
    await screen.findByText('Recorded');
    expect(t.records).toHaveLength(2);
  });

  it('shows the storage banner via the hook on StorageFullError', async () => {
    const setBanner = vi.fn();
    const t = setup({
      record: async () => {
        const e = new Error('full');
        e.name = 'StorageFullError';
        throw e;
      },
    });
    t.value.setBanner = setBanner;
    await mount(<CountFlow wh="w1" />, t.value);
    await scan('Scan location', 'BIN-A');
    await scan('Scan product', 'WIDGET');
    await setQty('Counted quantity', 5);
    await click('Confirm count');
    await waitFor(() => expect(setBanner).toHaveBeenCalledWith('storage'));
    await screen.findByText(/storage is full/i);
  });

  it('rejects unknown and inactive scans without recording', async () => {
    const t = setup();
    await mount(<CountFlow wh="w1" />, t.value);
    await scan('Scan location', 'NOPE');
    await screen.findByText('Not found: NOPE');
    await scan('Scan location', 'BIN-OFF');
    await screen.findByText('Location inactive');
    await scan('Scan location', 'BIN-A');
    await scan('Scan product', 'NOPE2');
    await screen.findByText('Not found: NOPE2');
    expect(t.records).toHaveLength(0);
  });
});

describe('Adjust', () => {
  const reasons = [
    { code: 'DAMAGED', label: 'Damaged' },
    { code: 'COUNT_AUTO', label: 'Auto count' },
    { code: 'INITIAL', label: 'Initial' },
  ];

  it('requires a reason, then records ADJUST and hides system codes', async () => {
    const t = setup({
      reasons,
      stock: [{ skuId: 'sku1', locationId: 'locA', qty: 9, pendingDelta: 0 }],
    });
    await mount(<AdjustFlow wh="w1" />, t.value);
    await scan('Scan location', 'BIN-A');
    await scan('Scan product', 'WIDGET');
    await screen.findByText('On hand: 9');
    await setQty('Adjustment (negative removes)', -3);
    await click('Confirm adjustment');
    await screen.findByText('Reason is required');
    expect(t.records).toHaveLength(0);
    const options = await waitFor(() => {
      const o = [...screen.getByLabelText('Reason').querySelectorAll('option')];
      expect(o.length).toBeGreaterThan(1);
      return o.map((x) => x.textContent);
    });
    expect(options).toEqual(['Choose a reason', 'Damaged']);
    fireEvent.change(screen.getByLabelText('Reason'), {
      target: { value: 'DAMAGED' },
    });
    await click('Confirm adjustment');
    await screen.findByText('Recorded');
    expect(t.records).toHaveLength(1);
    expect(t.records[0]).toMatchObject({
      type: 'ADJUST',
      qty: -3,
      reasonCode: 'DAMAGED',
      locationId: 'locA',
    });
  });

  it('rejects a zero quantity', async () => {
    const t = setup({ reasons });
    await mount(<AdjustFlow wh="w1" />, t.value);
    await scan('Scan location', 'BIN-A');
    await scan('Scan product', 'WIDGET');
    await setQty('Adjustment (negative removes)', 0);
    await click('Confirm adjustment');
    await screen.findByText(/other than 0/);
    expect(t.records).toHaveLength(0);
  });

  it('shows Not found for an unknown barcode', async () => {
    const t = setup({ reasons });
    await mount(<AdjustFlow wh="w1" />, t.value);
    await scan('Scan location', 'BIN-A');
    await scan('Scan product', 'ZZZ');
    await screen.findByText('Not found: ZZZ');
    expect(t.records).toHaveLength(0);
  });
});

describe('Move', () => {
  async function toQty(t: ReturnType<typeof setup>) {
    await mount(<MoveFlow wh="w1" />, t.value);
    await scan('Scan source location', 'BIN-A');
    await scan('Scan product', 'WIDGET');
    await setQty('Quantity', 4);
  }

  it('shows the displayed qty at the source and records MOVE', async () => {
    const t = setup({
      stock: [{ skuId: 'sku1', locationId: 'locA', qty: 11, pendingDelta: 0 }],
    });
    await toQty(t);
    await screen.findByText('On hand: 11');
    await scan('Scan destination location', 'BIN-B');
    await click('Confirm move');
    await screen.findByText('Recorded');
    expect(t.records).toHaveLength(1);
    expect(t.records[0]).toMatchObject({
      type: 'MOVE',
      fromLocationId: 'locA',
      toLocationId: 'locB',
      qty: 4,
    });
  });

  it('rejects the same destination inline', async () => {
    const t = setup();
    await toQty(t);
    await scan('Scan destination location', 'BIN-A');
    await screen.findByText('Destination must differ from source');
    await click('Confirm move');
    await screen.findByText('Scan the destination location');
    expect(t.records).toHaveLength(0);
  });

  it('records TRANSFER_OUT to another warehouse, excluding catalog and this warehouse', async () => {
    const t = setup();
    await toQty(t);
    fireEvent.click(await screen.findByText('Other warehouse'));
    const select = await screen.findByLabelText('Destination warehouse');
    expect(
      [...select.querySelectorAll('option')].map((o) =>
        o.getAttribute('value'),
      ),
    ).toEqual(['', 'w2', 'w3']);
    fireEvent.change(select, { target: { value: 'w2' } });
    await click('Confirm transfer out');
    await screen.findByText('Recorded');
    expect(t.records).toHaveLength(1);
    expect(t.records[0]).toMatchObject({
      type: 'TRANSFER_OUT',
      fromLocationId: 'locA',
      counterpartWarehouseId: 'w2',
      qty: 4,
    });
    expect((t.records[0] as { transferId: string }).transferId).toMatch(
      /^[0-9a-f-]{36}$/,
    );
  });
});

describe('Transfer in', () => {
  const U = '33333333-3333-4333-8333-333333333333';
  it('records TRANSFER_IN with the OUT ref and qty', async () => {
    const t = setup({
      inTransit: [
        {
          movementId: 'm1',
          fromWarehouseId: 'w2',
          skuId: 'sku1',
          qty: 6,
          ref: U,
          occurredAt: new Date(),
        },
      ],
    });
    await mount(<TransferInFlow wh="w1" />, t.value);
    await click('Receive');
    await scan('Scan destination location', 'BIN-B');
    await click('Confirm receipt');
    await screen.findByText('Recorded');
    expect(t.records).toHaveLength(1);
    expect(t.records[0]).toMatchObject({
      type: 'TRANSFER_IN',
      skuId: 'sku1',
      toLocationId: 'locB',
      qty: 6,
      transferId: U,
      counterpartWarehouseId: 'w2',
    });
  });

  it('rejects an unknown destination', async () => {
    const t = setup({
      inTransit: [
        {
          movementId: 'm1',
          fromWarehouseId: 'w2',
          skuId: 'sku1',
          qty: 6,
          ref: U,
          occurredAt: new Date(),
        },
      ],
    });
    await mount(<TransferInFlow wh="w1" />, t.value);
    await click('Receive');
    await scan('Scan destination location', 'NOPE');
    await screen.findByText('Not found: NOPE');
    expect(t.records).toHaveLength(0);
  });
});

describe('Pick', () => {
  const lists = () => [
    {
      id: 'pl1',
      status: 'OPEN',
      createdAt: new Date(),
      lines: [
        {
          id: 'ln1',
          skuId: 'sku1',
          locationId: 'locA',
          qtyRequested: 5,
          pickedQty: 5,
        },
        {
          id: 'ln2',
          skuId: 'sku2',
          locationId: 'locB',
          qtyRequested: 3,
          pickedQty: 1,
        },
      ],
    },
  ];

  it('rejects a wrong location and a wrong product, recording nothing', async () => {
    const t = setup({ pickLists: lists() });
    await mount(<PickFlow wh="w1" />, t.value);
    await click('Start');
    await scan('Scan location', 'BIN-A');
    await screen.findByText('Wrong location');
    await scan('Scan location', 'BIN-B');
    await scan('Scan product', 'WIDGET');
    await screen.findByText('Wrong product');
    expect(t.records).toHaveLength(0);
  });

  it('skips completed lines, defaults qty to the remainder and records PICK with ref', async () => {
    const t = setup({ pickLists: lists() });
    await mount(<PickFlow wh="w1" />, t.value);
    await click('Start');
    expect(screen.queryByText(/sku1 at locA/)).toBeNull();
    await scan('Scan location', 'BIN-B');
    await scan('Scan product', 'GADGET');
    const qty = (await screen.findByLabelText('Quantity')) as HTMLInputElement;
    expect(qty.value).toBe('2');
    await click('Confirm pick');
    await screen.findByText('Recorded');
    expect(t.records).toHaveLength(1);
    expect(t.records[0]).toMatchObject({
      type: 'PICK',
      skuId: 'sku2',
      fromLocationId: 'locB',
      qty: 2,
      ref: 'ln2',
    });
  });

  it('warns on over-pick but allows it, and Show completed lists finished lines', async () => {
    const t = setup({ pickLists: lists() });
    await mount(<PickFlow wh="w1" />, t.value);
    await click('Start');
    fireEvent.click(await screen.findByLabelText('Show completed'));
    await screen.findByText(/sku1 at locA/);
    await scan('Scan location', 'BIN-B');
    await scan('Scan product', 'GADGET');
    await setQty('Quantity', 9);
    await screen.findByText('More than requested');
    await click('Confirm pick');
    await screen.findByText('Recorded');
    expect(t.records[0]).toMatchObject({ type: 'PICK', qty: 9, ref: 'ln2' });
  });
});

describe('ScreenFrame', () => {
  it('redirects to login when there is no cached session', async () => {
    localStorage.removeItem('fi:session');
    const t = setup();
    const router = await mount(
      <ScreenFrame wh="w1" title="Count">
        <p>content</p>
      </ScreenFrame>,
      t.value,
    );
    await waitFor(() =>
      expect(router.state.location.pathname).toBe('/h/login'),
    );
  });

  it('renders the content with a cached (even expired) session', async () => {
    const t = setup();
    await mount(
      <ScreenFrame wh="w1" title="Count">
        <p>content</p>
      </ScreenFrame>,
      t.value,
    );
    await screen.findByText('content');
  });
});
