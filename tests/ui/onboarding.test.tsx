// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { OnboardingTour } from '#/ui/OnboardingTour';
import {
  DESK_TOUR,
  HANDHELD_TOUR,
  markTourSeen,
  requestTourReplay,
  TOUR_KEYS,
  type TourStepDef,
  tourSeen,
  visibleSteps,
} from '#/ui/onboarding';

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
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});
afterEach(cleanup);

const STEPS: TourStepDef[] = [
  { id: 'welcome', title: 'Welcome', body: 'Hello.' },
  { id: 'a', target: '[data-tour="a"]', title: 'Step A', body: 'A.' },
  { id: 'gone', target: '[data-tour="gone"]', title: 'Gone', body: 'Missing.' },
];

describe('visibleSteps', () => {
  it('keeps centred steps and shown targets, drops missing or hidden ones', () => {
    document.body.innerHTML =
      '<div data-tour="a"></div><div data-tour="b"></div>';
    const steps: TourStepDef[] = [
      ...STEPS,
      { id: 'b', target: '[data-tour="b"]', title: 'B', body: 'B.' },
    ];
    const ids = visibleSteps(
      steps,
      (el) => el.getAttribute('data-tour') !== 'b',
    ).map((s) => s.id);
    expect(ids).toEqual(['welcome', 'a']);
    document.body.innerHTML = '';
  });
});

describe('seen flag', () => {
  it('is unset until marked, then set', () => {
    expect(tourSeen(TOUR_KEYS.desk)).toBe(false);
    markTourSeen(TOUR_KEYS.desk);
    expect(tourSeen(TOUR_KEYS.desk)).toBe(true);
    expect(tourSeen(TOUR_KEYS.handheld)).toBe(false);
  });

  it('counts as seen when storage is unavailable, so it never nags', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    } as unknown as Storage;
    expect(tourSeen(TOUR_KEYS.desk, broken)).toBe(true);
    expect(() => markTourSeen(TOUR_KEYS.desk, broken)).not.toThrow();
  });
});

function show(autoStart = true) {
  return render(
    <MantineProvider>
      <div data-tour="a">target</div>
      <OnboardingTour
        storageKey={TOUR_KEYS.desk}
        steps={STEPS}
        autoStart={autoStart}
      />
    </MantineProvider>,
  );
}

describe('OnboardingTour', () => {
  it('starts automatically when not yet seen', async () => {
    show();
    expect(await screen.findByText('Welcome')).toBeTruthy();
  });

  it('does not start when already seen, or when auto start is off', async () => {
    markTourSeen(TOUR_KEYS.desk);
    show();
    await act(async () => {});
    expect(screen.queryByText('Welcome')).toBeNull();
    cleanup();
    window.localStorage.clear();
    show(false);
    await act(async () => {});
    expect(screen.queryByText('Welcome')).toBeNull();
  });

  it('marks the tour seen when it is closed with Escape', async () => {
    show();
    await screen.findByText('Welcome');
    fireEvent.keyDown(window, { key: 'Escape' });
    await act(async () => {});
    expect(tourSeen(TOUR_KEYS.desk)).toBe(true);
  });

  it('marks the tour seen when it is skipped', async () => {
    show();
    await screen.findByText('Welcome');
    fireEvent.click(screen.getByRole('button', { name: 'Skip' }));
    await act(async () => {});
    expect(tourSeen(TOUR_KEYS.desk)).toBe(true);
  });

  it('replays on request even after it was seen', async () => {
    markTourSeen(TOUR_KEYS.desk);
    show();
    await act(async () => {});
    expect(screen.queryByText('Welcome')).toBeNull();
    act(() => requestTourReplay(TOUR_KEYS.desk));
    expect(await screen.findByText('Welcome')).toBeTruthy();
  });

  it('replays on mount when a replay was requested before navigating', async () => {
    markTourSeen(TOUR_KEYS.desk);
    requestTourReplay(TOUR_KEYS.desk);
    show();
    expect(await screen.findByText('Welcome')).toBeTruthy();
    // The request is one-shot.
    cleanup();
    show();
    await act(async () => {});
    expect(screen.queryByText('Welcome')).toBeNull();
  });
});

describe('tour copy', () => {
  it('desk tour', () => {
    expect(DESK_TOUR.map((s) => [s.title, s.body, s.target ?? null])).toEqual([
      [
        'Welcome to the supervisor desk',
        'Handhelds record stock offline. This is where you sort out what happened when they sync.',
        null,
      ],
      [
        'Warehouse',
        "Switch warehouse here. The page you're on stays the same.",
        '[data-tour="rail-switcher"]',
      ],
      [
        'Sections',
        'Exceptions to review, stock and its ledger, and the pick lists and counts you hand out.',
        '[data-tour="rail-sections"]',
      ],
      [
        'Exception tiles',
        'Each tile counts open exceptions by type. Tap one to filter the list.',
        '[data-tour="exception-tiles"]',
      ],
      [
        'The list',
        'Open an exception to see when things happened and when they arrived, then accept, adjust, recount or dismiss it.',
        '[data-tour="exception-list"]',
      ],
      [
        'Settings',
        'Switch light or dark here, and replay this tour any time.',
        '[data-tour="rail-footer"]',
      ],
    ]);
  });

  it('handheld tour', () => {
    expect(
      HANDHELD_TOUR.map((s) => [s.title, s.body, s.target ?? null]),
    ).toEqual([
      [
        'Welcome',
        "Everything you record works offline and syncs when you're back in range.",
        null,
      ],
      [
        'Status',
        "Shows what's still waiting to be sent. ✓ means everything is synced.",
        '[data-tour="sync-status"]',
      ],
      [
        'Sync now',
        'Send and refresh straight away. It also happens on its own.',
        '[data-tour="sync-now"]',
      ],
      [
        'Warehouse actions',
        "Count, move, pick, adjust or check stock. Counts are blind: you won't see the expected number.",
        '[data-tour="warehouse-actions"]',
      ],
      [
        'Theme',
        'Tap to switch between light, dark and auto.',
        '[data-tour="theme-toggle"]',
      ],
    ]);
  });
});
