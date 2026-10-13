import { AppShell, Burger } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { Link, type LinkProps } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { Wordmark } from '#/ui/Wordmark';

/** Inactive rail link text; legible on `--fi-rail` in both schemes. */
export const RAIL_LINK_COLOR = '#d6d3d1';
/** Text on the active (signal-filled) pill. */
export const RAIL_ACTIVE_INK = '#1c1917';

const BREAKPOINT = 900;

export type SidebarLink = {
  label: string;
  to: string;
  params?: Record<string, string>;
  active: boolean;
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
      <AppShell.Header
        className="fi-rail-top"
        hiddenFrom={`${BREAKPOINT}px`}
        withBorder={false}
      >
        <Burger
          opened={opened}
          onClick={toggle}
          aria-label="Open navigation"
          aria-expanded={opened}
          size="sm"
          color="var(--fi-signal)"
        />
        <Wordmark size="sm" />
      </AppShell.Header>
      <AppShell.Navbar className="fi-rail" withBorder={false}>
        <div className="fi-stripe fi-rail-stripe" aria-hidden="true" />
        <div className="fi-rail-brand">
          <Wordmark />
        </div>
        <div className="fi-rail-switcher">{switcher}</div>
        <nav className="fi-rail-links" aria-label="Sections">
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
              <span className="fi-trunc">{l.label}</span>
            </Link>
          ))}
        </nav>
        <div className="fi-rail-footer">{footer}</div>
      </AppShell.Navbar>
      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
