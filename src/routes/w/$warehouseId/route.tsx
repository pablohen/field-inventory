import { Alert, Text } from '@mantine/core';
import {
  ClipboardTextIcon,
  GearSixIcon,
  ListChecksIcon,
  PackageIcon,
  WarningIcon,
} from '@phosphor-icons/react';
import { useQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { onSessionExpired, watchDeskAuth } from '#/desk/auth-error';
import { SignOutButton } from '#/desk/components/SignOutButton';
import { WarehouseSwitcher } from '#/desk/components/WarehouseSwitcher';
import { deskCall } from '#/desk/desk-call';
import { getDeskSession, getWarehouses } from '#/server/desk/desk-auth.fn';
import { AppShellSidebar } from '#/ui/AppShellSidebar';

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

const DESK_LINKS = [
  {
    to: '/w/$warehouseId/exceptions',
    label: 'Exceptions',
    seg: 'exceptions',
    icon: WarningIcon,
  },
  {
    to: '/w/$warehouseId/stock',
    label: 'Stock',
    seg: 'stock',
    icon: PackageIcon,
  },
  {
    to: '/w/$warehouseId/pick-lists',
    label: 'Pick lists',
    seg: 'pick-lists',
    icon: ListChecksIcon,
  },
  {
    to: '/w/$warehouseId/counts',
    label: 'Counts',
    seg: 'counts',
    icon: ClipboardTextIcon,
  },
] as const;

const assignUrl = (url: string) => window.location.assign(url);

export function DeskLayoutView({
  warehouseId,
  session,
  navigate = assignUrl,
}: {
  warehouseId: string;
  session: { name: string; role?: string };
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

  // An expired session surfaces as an auth error on a polling query or a save.
  useEffect(() => {
    const toLogin = () => navigate('/desk/login');
    const stopWatch = watchDeskAuth(queryClient, toLogin);
    const stopSaves = onSessionExpired(toLogin);
    return () => {
      stopWatch();
      stopSaves();
    };
  }, [queryClient, navigate]);

  const links = DESK_LINKS.map((l) => ({
    label: l.label,
    to: l.to,
    icon: l.icon,
    params: { warehouseId },
    active: pathname.endsWith(`/${l.seg}`) || pathname.includes(`/${l.seg}/`),
  }));

  return (
    <AppShellSidebar
      switcher={
        <WarehouseSwitcher
          warehouseId={warehouseId}
          warehouses={warehouses}
          pathname={pathname}
        />
      }
      links={links}
      footer={
        <>
          {session.role === 'admin' && (
            <Link to="/admin" className="fi-icon-link">
              <GearSixIcon size={16} weight="bold" aria-hidden="true" />
              Admin
            </Link>
          )}
          <Text size="sm" className="fi-trunc" title={session.name}>
            {session.name}
          </Text>
          <SignOutButton />
        </>
      }
    >
      {known === false ? (
        <Alert color="red">Warehouse not found</Alert>
      ) : (
        <Outlet />
      )}
    </AppShellSidebar>
  );
}
