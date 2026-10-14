// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ThemeToggle } from '#/ui/ThemeToggle';

const STORAGE_KEY = 'mantine-color-scheme-value';

beforeAll(() => {
  // The OS prefers light, so "auto" resolves to light.
  window.matchMedia = ((q: string) => ({
    matches: false,
    media: q,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
    onchange: null,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => window.localStorage.clear());
afterEach(cleanup);

const scheme = () =>
  document.documentElement.getAttribute('data-mantine-color-scheme');

function show(variant: 'segmented' | 'cycle') {
  return render(
    <MantineProvider defaultColorScheme="auto">
      <ThemeToggle variant={variant} />
    </MantineProvider>,
  );
}

describe('ThemeToggle, segmented', () => {
  it('offers Light, Dark and Auto, with Auto selected by default', () => {
    show('segmented');
    expect(
      screen.getByRole('radio', { name: 'Auto' }).getAttribute('checked'),
    ).not.toBeNull();
    expect(screen.getByRole('radio', { name: 'Light' })).toBeTruthy();
    expect(screen.getByRole('radio', { name: 'Dark' })).toBeTruthy();
  });

  it('applies and remembers each choice', () => {
    show('segmented');
    fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    expect(scheme()).toBe('dark');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('dark');

    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    expect(scheme()).toBe('light');
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('light');

    fireEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('auto');
    expect(scheme()).toBe('light'); // OS prefers light
  });
});

describe('ThemeToggle, cycle', () => {
  it('cycles Auto → Light → Dark → Auto with a descriptive label', () => {
    show('cycle');
    const btn = () => screen.getByRole('button', { name: /^Theme: / });
    expect(btn().getAttribute('aria-label')).toBe(
      'Theme: Auto. Switch to Light',
    );

    fireEvent.click(btn());
    expect(scheme()).toBe('light');
    expect(btn().getAttribute('aria-label')).toBe(
      'Theme: Light. Switch to Dark',
    );

    fireEvent.click(btn());
    expect(scheme()).toBe('dark');
    expect(btn().getAttribute('aria-label')).toBe(
      'Theme: Dark. Switch to Auto',
    );

    fireEvent.click(btn());
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('auto');
    expect(btn().getAttribute('aria-label')).toBe(
      'Theme: Auto. Switch to Light',
    );
  });

  it('is a 48px touch target', () => {
    show('cycle');
    const btn = screen.getByRole('button', { name: /^Theme: / });
    expect(Number.parseInt(btn.style.minHeight, 10)).toBeGreaterThanOrEqual(48);
    expect(Number.parseInt(btn.style.minWidth, 10)).toBeGreaterThanOrEqual(48);
  });
});
