import { Alert, Container, Group, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { watchDeskAuth } from '#/desk/auth-error';
import { DeskNav } from '#/desk/components/DeskNav';
import { SignOutButton } from '#/desk/components/SignOutButton';
import { deskCall } from '#/desk/desk-call';
import { getDeskSession, getWarehouses } from '#/server/desk/desk-auth.fn';

export const Route = createFileRoute('/w/$warehouseId')({
  beforeLoad: async () => {
    const session = await deskCall(getDeskSession);
    if (!session) throw redirect({ to: '/desk/login' });
    return { session };
  },
  component: DeskLayout,
});

function DeskLayout() {
  const { warehouseId } = Route.useParams();
  const { session } = Route.useRouteContext();
  return <DeskLayoutView warehouseId={warehouseId} session={session} />;
}

const assignUrl = (url: string) => window.location.assign(url);

export function DeskLayoutView({
  warehouseId,
  session,
  navigate = assignUrl,
}: {
  warehouseId: string;
  session: { name: string };
  navigate?: (url: string) => void;
}) {
  const { queryClient } = useRouter().options.context;
  // Every desk query polls; set once, before children mount.
  useState(() =>
    queryClient.setQueryDefaults(['desk'], { refetchInterval: 10000 }),
  );
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const whs = useQuery({
    queryKey: ['desk', 'warehouses'],
    queryFn: () => deskCall(getWarehouses),
  });
  const warehouses = Array.isArray(whs.data) ? whs.data : [];
  const known = Array.isArray(whs.data)
    ? whs.data.some((w) => w.id === warehouseId)
    : undefined;

  // An expired session surfaces as an auth error on a polling query.
  useEffect(
    () => watchDeskAuth(queryClient, () => navigate('/desk/login')),
    [queryClient, navigate],
  );

  return (
    <Container size="xl" py="md">
      <Stack>
        <Group justify="space-between" align="flex-end">
          <DeskNav
            warehouseId={warehouseId}
            warehouses={warehouses}
            pathname={pathname}
          />
          <Group gap="sm">
            <Text size="sm">{session.name}</Text>
            <SignOutButton />
          </Group>
        </Group>
        {known === false ? (
          <Alert color="red">Warehouse not found</Alert>
        ) : (
          <Outlet />
        )}
      </Stack>
    </Container>
  );
}
