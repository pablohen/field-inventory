import { Text } from '@mantine/core';
import {
  ArrowLeftIcon,
  BarcodeIcon,
  DeviceMobileIcon,
  ListBulletsIcon,
  TagIcon,
  UsersIcon,
  WarehouseIcon,
} from '@phosphor-icons/react';
import {
  createFileRoute,
  Link,
  Outlet,
  redirect,
  useRouter,
  useRouterState,
} from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { adminTarget } from '#/admin/admin-target';
import { onSessionExpired, watchDeskAuth } from '#/desk/auth-error';
import { SignOutButton } from '#/desk/components/SignOutButton';
import { deskCall } from '#/desk/desk-call';
import { getDeskSession } from '#/server/desk/desk-auth.fn';
import { AppShellSidebar } from '#/ui/AppShellSidebar';

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

const ADMIN_LINKS = [
  { to: '/admin/warehouses', label: 'Warehouses', icon: WarehouseIcon },
  { to: '/admin/users', label: 'Users', icon: UsersIcon },
  { to: '/admin/devices', label: 'Devices', icon: DeviceMobileIcon },
  { to: '/admin/products', label: 'Products', icon: BarcodeIcon },
  { to: '/admin/categories', label: 'Categories', icon: TagIcon },
  { to: '/admin/reason-codes', label: 'Reason codes', icon: ListBulletsIcon },
] as const;

const assignUrl = (url: string) => window.location.assign(url);

export function AdminLayoutView({
  session,
  navigate = assignUrl,
}: {
  session: { name: string } | null;
  navigate?: (url: string) => void;
}) {
  const { queryClient } = useRouter().options.context;
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  // Every admin query polls; set once, before children mount.
  useState(() =>
    queryClient.setQueryDefaults(['admin'], { refetchInterval: 10000 }),
  );
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
  return (
    <AppShellSidebar
      switcher={
        <Text fw={800} size="lg" c="inherit">
          Admin
        </Text>
      }
      links={ADMIN_LINKS.map((l) => ({
        ...l,
        active: pathname === l.to || pathname.startsWith(`${l.to}/`),
      }))}
      footer={
        <>
          <Link to="/" className="fi-icon-link">
            <ArrowLeftIcon size={16} weight="bold" aria-hidden="true" />
            Back to desk
          </Link>
          <Text size="sm" className="fi-trunc" title={session?.name}>
            {session?.name}
          </Text>
          <SignOutButton />
        </>
      }
    >
      <Outlet />
    </AppShellSidebar>
  );
}
