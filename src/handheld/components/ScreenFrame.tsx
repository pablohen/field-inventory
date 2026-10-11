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
      <Anchor component={Link} to="/h">
        Warehouses
      </Anchor>
      <Title order={4}>
        {title} in {wh}
      </Title>
      {children}
    </>
  );
}
