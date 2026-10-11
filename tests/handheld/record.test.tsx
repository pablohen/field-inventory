// @vitest-environment jsdom
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { type MovementInput, movementInputSchema } from '#/domain/schemas';
import { HandheldContext, type HandheldValue } from '#/handheld/context';
import { buildMovementInput, useRecordMovement } from '#/handheld/record';

const ctx = (newId: () => string = () => crypto.randomUUID()) => ({
  warehouseId: 'w1',
  userId: 'u1',
  deviceId: 'd1',
  now: new Date('2026-01-01T10:00:00Z'),
  newId,
});

describe('buildMovementInput', () => {
  const U = '22222222-2222-4222-8222-222222222222';
  const cases: [MovementInput['type'], Record<string, unknown>][] = [
    ['PICK', { skuId: 's1', fromLocationId: 'l1', qty: 1, ref: 'line1' }],
    ['MOVE', { skuId: 's1', fromLocationId: 'l1', toLocationId: 'l2', qty: 3 }],
    ['COUNT', { skuId: 's1', locationId: 'l1', qty: 0, ref: 't1' }],
    [
      'ADJUST',
      { skuId: 's1', locationId: 'l1', qty: -2, reasonCode: 'DAMAGED' },
    ],
    [
      'TRANSFER_OUT',
      {
        skuId: 's1',
        fromLocationId: 'l1',
        qty: 4,
        transferId: U,
        counterpartWarehouseId: 'w2',
      },
    ],
    [
      'TRANSFER_IN',
      {
        skuId: 's1',
        toLocationId: 'l1',
        qty: 4,
        transferId: U,
        counterpartWarehouseId: 'w2',
      },
    ],
  ];

  it.each(cases)('builds a schema-valid %s', (kind, fields) => {
    const newId = vi.fn(() => '11111111-1111-4111-8111-111111111111');
    const input = buildMovementInput(kind, fields, ctx(newId));
    expect(movementInputSchema.safeParse(input).success).toBe(true);
    expect(input).toMatchObject({
      type: kind,
      id: '11111111-1111-4111-8111-111111111111',
      warehouseId: 'w1',
      userId: 'u1',
      deviceId: 'd1',
      occurredAt: new Date('2026-01-01T10:00:00Z'),
    });
    expect(newId).toHaveBeenCalledTimes(1);
  });

  it('throws on invalid fields', () => {
    expect(() =>
      buildMovementInput('PICK', { skuId: 's1', qty: 1 }, ctx()),
    ).toThrow();
  });
});

describe('useRecordMovement', () => {
  const input = buildMovementInput(
    'PICK',
    { skuId: 's1', fromLocationId: 'l1', qty: 2 },
    ctx(),
  );
  const stock = [
    { skuId: 's1', locationId: 'l1', qty: 10, pendingDelta: 0 },
    { skuId: 's2', locationId: 'l1', qty: 5, pendingDelta: 0 },
  ];

  function setup(record: (i: MovementInput) => Promise<void>) {
    const queryClient = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    queryClient.setQueryData(['h', 'w1', 'stock'], stock);
    queryClient.setQueryData(['h', 'w1', 'stock', { skuId: 's2' }], [stock[1]]);
    const setBanner = vi.fn();
    const value: HandheldValue = {
      backend: {
        role: 'leader',
        onRoleChange: () => () => {},
        call: ((method: string, arg: MovementInput) => {
          if (method !== 'record') throw new Error('unexpected');
          return record(arg);
        }) as never,
      },
      syncState: null,
      session: null,
      banner: null,
      setBanner,
    };
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <HandheldContext.Provider value={value}>
          {children}
        </HandheldContext.Provider>
      </QueryClientProvider>
    );
    const hook = renderHook(() => useRecordMovement('w1'), { wrapper });
    return { queryClient, setBanner, ...hook };
  }

  it('patches optimistically and invalidates ["h", wh] on success', async () => {
    let release: () => void = () => {};
    const record = vi.fn(() => new Promise<void>((res) => (release = res)));
    const { queryClient, result } = setup(record);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    act(() => result.current.mutate(input));
    await waitFor(() => expect(result.current.isPending).toBe(true));
    const patched = queryClient.getQueryData<typeof stock>([
      'h',
      'w1',
      'stock',
    ]);
    expect(patched?.[0]).toEqual({
      skuId: 's1',
      locationId: 'l1',
      qty: 8,
      pendingDelta: -2,
    });
    expect(patched?.[1]).toEqual(stock[1]);
    // The s2-filtered entry is untouched (the delta is for s1).
    expect(
      queryClient.getQueryData(['h', 'w1', 'stock', { skuId: 's2' }]),
    ).toEqual([stock[1]]);

    release();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(record).toHaveBeenCalledWith(input);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['h', 'w1'] });
  });

  it('rolls back and raises the storage banner on StorageFullError', async () => {
    const err = new Error('Device storage is full');
    err.name = 'StorageFullError';
    const { queryClient, setBanner, result } = setup(async () => {
      throw err;
    });
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');

    await act(async () => {
      await result.current.mutateAsync(input).catch(() => {});
    });
    expect(queryClient.getQueryData(['h', 'w1', 'stock'])).toEqual(stock);
    expect(setBanner).toHaveBeenCalledWith('storage');
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['h', 'w1'] });
  });

  it('rolls back without a banner for other errors', async () => {
    const { queryClient, setBanner, result } = setup(async () => {
      throw new Error('boom');
    });
    await act(async () => {
      await result.current.mutateAsync(input).catch(() => {});
    });
    expect(queryClient.getQueryData(['h', 'w1', 'stock'])).toEqual(stock);
    expect(setBanner).not.toHaveBeenCalled();
  });
});
