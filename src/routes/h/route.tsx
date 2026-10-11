import { Button, Container, Group, Stack, Title } from '@mantine/core';
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
} from '@tanstack/react-router';
import { StatusPill } from '#/handheld/components/StatusPill';
import { useHandheld } from '#/handheld/context';
import { HandheldProvider } from '#/handheld/HandheldProvider';
import { getCachedSession } from '#/handheld/session-store';
import { signOut } from '#/handheld/sign-out';

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
