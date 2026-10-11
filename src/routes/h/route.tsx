import { Button, Container, Group, Stack, Title } from '@mantine/core';
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { useEffect } from 'react';
import { StatusPill } from '#/handheld/components/StatusPill';
import { useHandheld } from '#/handheld/context';
import { HandheldProvider } from '#/handheld/HandheldProvider';
import { getCachedSession } from '#/handheld/session-store';
import { signOut } from '#/handheld/sign-out';
import { SW_SCOPE, SW_URL } from '#/pwa-options';

export const Route = createFileRoute('/h')({
  ssr: false,
  // Only a missing cached session redirects; an expired one still allows recording.
  beforeLoad: ({ location }) => {
    if (location.pathname !== '/h/login' && !getCachedSession()) {
      throw redirect({ to: '/h/login' });
    }
  },
  component: HandheldLayout,
});

/** Drops registrations left by the old `/h`-scoped SW (they would shadow `/`). */
async function unregisterLegacyScopes(): Promise<void> {
  const regs = await navigator.serviceWorker.getRegistrations();
  await Promise.all(
    regs
      .filter((r) => /\/h\/?$/.test(new URL(r.scope).pathname))
      .map((r) => r.unregister()),
  );
}

/** Production only; registered at `/` so engine workers are controlled too. */
function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  // A new SW claims open pages; reload once so they drop stale chunk refs.
  const hadController = !!navigator.serviceWorker.controller;
  let reloaded = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloaded || !hadController) return;
    reloaded = true;
    location.reload();
  });
  navigator.serviceWorker
    .register(SW_URL, { scope: SW_SCOPE })
    .then(unregisterLegacyScopes)
    .catch((err) => console.error('service worker registration failed', err));
}

function Header() {
  const { session } = useHandheld();
  return (
    <Stack gap="xs">
      <Group justify="space-between">
        <Title order={3}>
          <Link to="/h" style={{ color: 'inherit', textDecoration: 'none' }}>
            Field Inventory
          </Link>
        </Title>
        {session && (
          <Button size="compact-sm" variant="subtle" onClick={() => signOut()}>
            Sign out
          </Button>
        )}
      </Group>
      <StatusPill />
    </Stack>
  );
}

function HandheldLayout() {
  useEffect(registerServiceWorker, []);
  return (
    <HandheldProvider>
      <Container size="sm" py="md">
        <Stack>
          <Header />
          <Outlet />
        </Stack>
      </Container>
    </HandheldProvider>
  );
}
