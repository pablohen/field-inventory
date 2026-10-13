import { Anchor, Title } from '@mantine/core';
import { Link, Navigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { getCachedSession } from '../session-store';

/** Title and back link for an action screen; no cached session redirects to login like the shell. */
export function ScreenFrame({
  wh,
  title,
  children,
}: {
  wh: string;
  title: string;
  children: ReactNode;
}) {
  if (!getCachedSession()) return <Navigate to="/h/login" />;
  return (
    <>
      <div className="fi-handheld-bar" style={{ background: 'var(--fi-rail)' }}>
        <div className="fi-stripe" style={{ height: 8 }} aria-hidden="true" />
        <div style={{ padding: '8px 12px 12px' }}>
          <Anchor
            component={Link}
            to="/h"
            style={{ color: 'var(--fi-signal)' }}
          >
            Warehouses
          </Anchor>
          <Title order={4} style={{ color: 'var(--fi-signal)' }}>
            {title} in {wh}
          </Title>
        </div>
      </div>
      {children}
    </>
  );
}
