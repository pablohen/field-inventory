/** One step of an onboarding tour; no `target` means a centred card. */
export type TourStepDef = {
  id: string;
  target?: string;
  title: string;
  body: string;
  /** Tooltip side; rail steps sit to the right so they don't cover the rail. */
  position?: 'right';
};

/** Per-device "seen" flags; bump the version to show a changed tour again. */
export const TOUR_KEYS = {
  desk: 'fi-tour:desk:v1',
  handheld: 'fi-tour:handheld:v1',
} as const;
export type TourKey = (typeof TOUR_KEYS)[keyof typeof TOUR_KEYS];

const REPLAY_EVENT = 'fi-tour-replay';
const replayKey = (key: TourKey) => `${key}:replay`;

const at = (target: string) => `[data-tour="${target}"]`;

export const DESK_TOUR: TourStepDef[] = [
  {
    id: 'welcome',
    title: 'Welcome to the supervisor desk',
    body: 'Handhelds record stock offline. This is where you sort out what happened when they sync.',
  },
  {
    id: 'switcher',
    target: at('rail-switcher'),
    title: 'Warehouse',
    body: "Switch warehouse here. The page you're on stays the same.",
    position: 'right',
  },
  {
    id: 'sections',
    target: at('rail-sections'),
    title: 'Sections',
    body: 'Exceptions to review, stock and its ledger, and the pick lists and counts you hand out.',
    position: 'right',
  },
  {
    id: 'tiles',
    target: at('exception-tiles'),
    title: 'Exception tiles',
    body: 'Each tile counts open exceptions by type. Tap one to filter the list.',
  },
  {
    id: 'list',
    target: at('exception-list'),
    title: 'The list',
    body: 'Open an exception to see when things happened and when they arrived, then accept, adjust, recount or dismiss it.',
  },
  {
    id: 'footer',
    target: at('rail-footer'),
    title: 'Settings',
    body: 'Switch light or dark here, and replay this tour any time.',
    position: 'right',
  },
];

export const HANDHELD_TOUR: TourStepDef[] = [
  {
    id: 'welcome',
    title: 'Welcome',
    body: "Everything you record works offline and syncs when you're back in range.",
  },
  {
    id: 'status',
    target: at('sync-status'),
    title: 'Status',
    body: "Shows what's still waiting to be sent. ✓ means everything is synced.",
  },
  {
    id: 'sync',
    target: at('sync-now'),
    title: 'Sync now',
    body: 'Send and refresh straight away. It also happens on its own.',
  },
  {
    id: 'actions',
    target: at('warehouse-actions'),
    title: 'Warehouse actions',
    body: "Count, move, pick, adjust or check stock. Counts are blind: you won't see the expected number.",
  },
  {
    id: 'theme',
    target: at('theme-toggle'),
    title: 'Theme',
    body: 'Tap to switch between light, dark and auto.',
  },
];

function local(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Unavailable storage counts as seen, so a blocked browser is never nagged. */
export function tourSeen(key: TourKey, storage = local()): boolean {
  try {
    return storage === null || storage.getItem(key) !== null;
  } catch {
    return true;
  }
}

export function markTourSeen(key: TourKey, storage = local()): void {
  try {
    storage?.setItem(key, 'done');
  } catch {
    // Storage blocked: nothing to remember.
  }
}

/**
 * Asks the tour to replay. Works across a navigation: the request waits in
 * sessionStorage for the tour to mount, and a mounted tour hears the event.
 */
export function requestTourReplay(key: TourKey): void {
  try {
    window.sessionStorage.setItem(replayKey(key), '1');
  } catch {
    // Fall through to the event for an already-mounted tour.
  }
  window.dispatchEvent(new CustomEvent(REPLAY_EVENT, { detail: key }));
}

/** Reads and clears a pending replay request. */
export function takeReplayRequest(key: TourKey): boolean {
  try {
    const pending = window.sessionStorage.getItem(replayKey(key)) !== null;
    window.sessionStorage.removeItem(replayKey(key));
    return pending;
  } catch {
    return false;
  }
}

export function onReplayRequest(key: TourKey, handler: () => void): () => void {
  const listener = (e: Event) => {
    if ((e as CustomEvent<TourKey>).detail === key) handler();
  };
  window.addEventListener(REPLAY_EVENT, listener);
  return () => window.removeEventListener(REPLAY_EVENT, listener);
}

/** Any tour's replay request, e.g. so the mobile drawer can get out of the way. */
export function onAnyReplayRequest(handler: () => void): () => void {
  window.addEventListener(REPLAY_EVENT, handler);
  return () => window.removeEventListener(REPLAY_EVENT, handler);
}

/** Visible by the browser's own rules where supported (jsdom: always). */
export function isShown(el: Element): boolean {
  const check = (el as Element & { checkVisibility?: (o?: object) => boolean })
    .checkVisibility;
  return check
    ? check.call(el, { visibilityProperty: true, contentVisibilityAuto: true })
    : true;
}

/**
 * Drops steps whose target is missing or not on screen (a collapsed sidebar,
 * no warehouses downloaded yet). Centred steps always stay.
 */
export function visibleSteps(
  steps: TourStepDef[],
  shown: (el: Element) => boolean = isShown,
): TourStepDef[] {
  return steps.filter((s) => {
    if (!s.target) return true;
    const el = document.querySelector(s.target);
    return el !== null && shown(el);
  });
}
