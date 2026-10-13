import { Container, Group, Stack, Text } from '@mantine/core';
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouter,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { adminTarget } from '#/admin/admin-target';
import { AdminNav } from '#/admin/components/AdminNav';
import { watchDeskAuth } from '#/desk/auth-error';
import { SignOutButton } from '#/desk/components/SignOutButton';
import { deskCall } from '#/desk/desk-call';
import { getDeskSession } from '#/server/desk/desk-auth.fn';

export const Route = createFileRoute('/admin')({
  beforeLoad: async () => {
    const session = await deskCall(getDeskSession);
    const target = adminTarget(session);
    if (target === '/desk/login') throw redirect({ to: '/desk/login' });
    if (target === '/') throw redirect({ to: '/' });
    return { session };
  },
  component: AdminLayout,
});

function AdminLayout() {
  const { session } = Route.useRouteContext();
  return <AdminLayoutView session={session} />;
}

const assignUrl = (url: string) => window.location.assign(url);

export function AdminLayoutView({
  session,
  navigate = assignUrl,
}: {
  session: { name: string } | null;
  navigate?: (url: string) => void;
}) {
  const { queryClient } = useRouter().options.context;
  // Every admin query polls; set once, before children mount.
  useState(() =>
    queryClient.setQueryDefaults(['admin'], { refetchInterval: 10000 }),
  );
  // An expired session surfaces as an auth error on a polling query.
  useEffect(
    () => watchDeskAuth(queryClient, () => navigate('/desk/login')),
    [queryClient, navigate],
  );
  return (
    <Container size="xl" py="md">
      <Stack>
        <Group justify="space-between" align="flex-end">
          <AdminNav />
          <Group gap="sm">
            <Link to="/">Back to desk</Link>
            <Text size="sm">{session?.name}</Text>
            <SignOutButton />
          </Group>
        </Group>
        <Outlet />
      </Stack>
    </Container>
  );
}
