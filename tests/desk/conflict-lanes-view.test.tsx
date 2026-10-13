// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { ConflictLanes } from '#/desk/components/ConflictLanes';
import type { TimelineMovement } from '#/server/desk/exceptions.server';

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
});
afterEach(cleanup);

function mv(
  i: number,
  involved: boolean,
  occurredAt: string,
  seq: number,
): TimelineMovement {
  return {
    id: `m${i}`,
    seq,
    type: 'COUNT',
    skuId: 'S1',
    fromLocationId: null,
    toLocationId: 'L1',
    qty: 3,
    reasonCode: null,
    userId: 'w1',
    deviceId: 'dev1',
    source: 'device',
    occurredAt,
    receivedAt: occurredAt,
    involved,
  };
}

const KEY = { skuId: 'S1', locationId: 'L1' };
const show = (ms: TimelineMovement[]) =>
  render(
    <MantineProvider>
      <ConflictLanes movements={ms} keyOf={KEY} names={{ w1: 'Wendy' }} />
    </MantineProvider>,
  );

describe('ConflictLanes', () => {
  it('draws one line per involved movement and reports late count', () => {
    const { container } = show([
      mv(1, true, '2026-03-01T10:00:00.000Z', 19),
      mv(2, true, '2026-03-01T10:30:00.000Z', 17),
      mv(3, false, '2026-03-01T09:00:00.000Z', 5),
    ]);
    expect(container.querySelectorAll('line[data-late]')).toHaveLength(2);
    expect(container.querySelectorAll('line[data-late="true"]')).toHaveLength(
      1,
    );
    expect(
      screen.getByRole('img', {
        name: 'Arrival order vs physical order: 1 late arrival(s)',
      }),
    ).toBeTruthy();
  });

  it('falls back to text above 12 involved movements', () => {
    const ms = Array.from({ length: 13 }, (_, i) =>
      mv(i, true, `2026-03-01T10:${String(i).padStart(2, '0')}:00.000Z`, i),
    );
    const { container } = show(ms);
    expect(container.querySelector('svg')).toBeNull();
    expect(
      screen.getByText('Too many movements to draw — see the lists below.'),
    ).toBeTruthy();
  });

  it('renders nothing with no involved movements', () => {
    const { container } = show([mv(1, false, '2026-03-01T10:00:00.000Z', 1)]);
    expect(container.querySelector('svg')).toBeNull();
    expect(screen.queryByText(/Too many movements/)).toBeNull();
    expect(
      container.querySelector('[data-testid="conflict-lanes"]'),
    ).toBeNull();
  });
});
