// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CountTiles } from '#/desk/components/CountTiles';

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});

afterEach(cleanup);

describe('CountTiles', () => {
  it('fills non-zero tiles and only outlines zero tiles', () => {
    render(
      <MantineProvider>
        <CountTiles counts={{ NEGATIVE_BALANCE: 1, COUNT_VARIANCE: 0 }} />
      </MantineProvider>,
    );
    expect(
      screen
        .getByRole('button', { name: 'NEGATIVE_BALANCE 1' })
        .getAttribute('data-filled'),
    ).toBe('true');
    expect(
      screen
        .getByRole('button', { name: 'COUNT_VARIANCE 0' })
        .getAttribute('data-filled'),
    ).toBe('false');
  });
});
