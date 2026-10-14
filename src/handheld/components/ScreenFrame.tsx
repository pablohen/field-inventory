import { Anchor, Title } from '@mantine/core';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { Link, Navigate } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { getCachedSession } from '../session-store';
import { TOUCH } from '../touch';

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
      <div
        style={{
          background: 'var(--fi-surface)',
          color: 'var(--fi-ink)',
          borderBottom: '2px solid var(--fi-ink)',
          padding: '8px 12px 12px',
        }}
      >
        <Anchor
          component={Link}
          to="/h"
          style={{
            ...TOUCH,
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            color: 'var(--fi-ink)',
          }}
        >
          <ArrowLeftIcon size={16} weight="bold" aria-hidden="true" />
          Warehouses
        </Anchor>
        <Title order={4}>
          {title} in {wh}
        </Title>
      </div>
      {children}
    </>
  );
}
