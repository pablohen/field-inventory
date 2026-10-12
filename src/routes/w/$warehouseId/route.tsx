import { Alert, Button, Container, Group, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import { useState } from 'react';
import { DeskNav } from '#/desk/components/DeskNav';
import {
  deskLogout,
  getDeskSession,
  getWarehouses,
} from '#/server/desk/desk-auth.fn';

export const Route = createFileRoute('/w/$warehouseId')({
  beforeLoad: async () => {
    const session = await getDeskSession();
    if (!session) throw redirect({ to: '/desk/login' });
    return { session };
  },
  component: DeskLayout,
});

function DeskLayout() {
  const { warehouseId } = Route.useParams();
  const { session } = Route.useRouteContext();
  const { queryClient } = useRouter().options.context;
  // Every desk query polls; set once, before children mount.
  useState(() =>
    queryClient.setQueryDefaults(['desk'], { refetchInterval: 10000 }),
  );
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const whs = useQuery({
    queryKey: ['desk', 'warehouses'],
    queryFn: () => getWarehouses(),
  });
  const known = whs.data?.some((w) => w.id === warehouseId);

  const signOut = async () => {
    try {
      await deskLogout();
    } finally {
      window.location.assign('/desk/login');
    }
  };

  return (
    <Container size="xl" py="md">
      <Stack>
        <Group justify="space-between" align="flex-end">
          <DeskNav
            warehouseId={warehouseId}
            warehouses={whs.data ?? []}
            pathname={pathname}
          />
          <Group gap="sm">
            <Text size="sm">{session.name}</Text>
            <Button size="compact-sm" variant="subtle" onClick={signOut}>
              Sign out
            </Button>
          </Group>
        </Group>
        {whs.data && !known ? (
          <Alert color="red">Warehouse not found</Alert>
        ) : (
          <Outlet />
        )}
      </Stack>
    </Container>
  );
}
