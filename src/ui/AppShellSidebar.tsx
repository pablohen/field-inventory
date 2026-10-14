import { AppShell, Burger } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import type { Icon } from '@phosphor-icons/react';
import { Link, type LinkProps, useRouterState } from '@tanstack/react-router';
import { type ReactNode, useEffect } from 'react';
import { onAnyReplayRequest } from '#/ui/onboarding';
import { ThemeToggle } from '#/ui/ThemeToggle';
import { Wordmark } from '#/ui/Wordmark';

/** Inactive rail link text; legible on `--fi-rail` in both schemes. */
export const RAIL_LINK_COLOR = '#d6d3d1';
/** Text on the active (signal-filled) pill. */
export const RAIL_ACTIVE_INK = '#1c1917';

const BREAKPOINT = 900;
const NAVBAR_ID = 'fi-navbar';

/**
 * True when `el` sits in the rail while it is a shut drawer (narrow screens).
 * Reads the drawer's state, not its computed visibility, which lags behind by
 * the slide-out animation.
 */
export function inCollapsedRail(el: Element): boolean {
  const narrow = window.matchMedia(
    `(max-width: ${BREAKPOINT - 0.02}px)`,
  ).matches;
  return narrow && el.closest('.fi-rail:not([data-open])') !== null;
}

export type SidebarLink = {
  label: string;
  to: string;
  params?: Record<string, string>;
  active: boolean;
  /** Decorative; the label stays the accessible name. */
  icon?: Icon;
};

export function AppShellSidebar({
  switcher,
  links,
  footer,
  children,
}: {
  switcher: ReactNode;
  links: SidebarLink[];
  footer: ReactNode;
  children: ReactNode;
}) {
  const [opened, { toggle, close }] = useDisclosure(false);
  // Any navigation (link, warehouse switch) closes the mobile drawer.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // biome-ignore lint/correctness/useExhaustiveDependencies: close on pathname change only
  useEffect(() => close(), [pathname]);
  // A tour replay from inside the drawer: get out of the tour's way.
  useEffect(() => onAnyReplayRequest(close), [close]);
  return (
    <AppShell
      header={{ height: { base: 48, [`${BREAKPOINT}px`]: 0 } }}
      navbar={{
        width: 200,
        breakpoint: BREAKPOINT,
        collapsed: { mobile: !opened },
      }}
      padding="md"
    >
      <AppShell.Header className="fi-rail-top" withBorder={false}>
        <Burger
          opened={opened}
          onClick={toggle}
          aria-label={opened ? 'Close navigation' : 'Open navigation'}
          aria-expanded={opened}
          aria-controls={NAVBAR_ID}
          size="sm"
          color="var(--fi-signal)"
        />
        <Wordmark size="sm" />
      </AppShell.Header>
      <AppShell.Navbar
        id={NAVBAR_ID}
        className="fi-rail"
        data-open={opened || undefined}
        withBorder={false}
      >
        <div className="fi-stripe fi-rail-stripe" aria-hidden="true" />
        <div className="fi-rail-brand">
          <Wordmark />
        </div>
        <div className="fi-rail-switcher" data-tour="rail-switcher">
          {switcher}
        </div>
        <nav
          className="fi-rail-links"
          aria-label="Sections"
          data-tour="rail-sections"
        >
          {links.map((l) => (
            <Link
              key={l.label}
              {...({ to: l.to, params: l.params } as LinkProps)}
              className="fi-rail-link"
              data-active={l.active || undefined}
              aria-current={l.active ? 'page' : undefined}
              title={l.label}
              onClick={close}
            >
              {l.icon && (
                <l.icon
                  size={18}
                  weight="bold"
                  aria-hidden="true"
                  className="fi-rail-icon"
                />
              )}
              <span className="fi-trunc">{l.label}</span>
            </Link>
          ))}
        </nav>
        <div className="fi-rail-footer" data-tour="rail-footer">
          <ThemeToggle variant="segmented" />
          {footer}
        </div>
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
