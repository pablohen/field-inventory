// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { AuthSplit } from '#/ui/AuthSplit';

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  // Mantine's SegmentedControl (the theme toggle) measures itself.
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(cleanup);

describe('AuthSplit', () => {
  it('renders wordmark, pitch, title and children in a form region', () => {
    render(
      <MantineProvider>
        <AuthSplit title="Supervisor sign-in">
          <button type="button">child</button>
        </AuthSplit>
      </MantineProvider>,
    );
    expect(screen.getByText('▲ Field Inventory')).toBeTruthy();
    expect(
      screen.getByText('Offline-first stock control. Every movement counted.'),
    ).toBeTruthy();
    const region = screen.getByRole('region', { name: 'Supervisor sign-in' });
    expect(
      within(region).getByRole('heading', { name: 'Supervisor sign-in' }),
    ).toBeTruthy();
    expect(within(region).getByText('child')).toBeTruthy();
  });

  it('offers the theme toggle on the login', () => {
    render(
      <MantineProvider>
        <AuthSplit title="Supervisor sign-in">
          <span />
        </AuthSplit>
      </MantineProvider>,
    );
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeTruthy();
  });
});
