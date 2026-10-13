import { Button, Drawer, Group, Loader, Stack, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { PinDialog } from '#/admin/components/PinDialog';
import { UserForm } from '#/admin/components/UserForm';
import { UserTable } from '#/admin/components/UserTable';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { errorMessage, RefreshNote } from '#/desk/components/RefreshNote';
import { deskCall } from '#/desk/desk-call';
import { listUsers } from '#/server/admin/users.fn';

export const Route = createFileRoute('/admin/users')({
  component: UsersRoute,
});

function UsersRoute() {
  const { session } = Route.useRouteContext();
  return <UsersPage currentUserId={session?.userId ?? ''} />;
}

export function UsersPage({ currentUserId }: { currentUserId: string }) {
  const [drawer, setDrawer] = useState(false);
  const [pinUser, setPinUser] = useState<{ id: string; name: string } | null>(
    null,
  );
  const list = useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => deskCall(listUsers),
  });
  const data = list.data;
  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Users</Title>
        <Button onClick={() => setDrawer(true)}>New user</Button>
      </Group>
      {list.isError && data && <RefreshNote />}
      {!data ? (
        list.isError ? (
          <DeskErrorAlert
            error={{ code: 'INVALID', message: errorMessage(list.error) }}
          />
        ) : (
          <Loader size="sm" />
        )
      ) : (
        <UserTable
          rows={data.users}
          currentUserId={currentUserId}
          onResetPin={setPinUser}
        />
      )}
      <Drawer
        opened={drawer}
        onClose={() => setDrawer(false)}
        position="right"
        size="lg"
        title="New user"
      >
        <UserForm onCreated={() => setDrawer(false)} />
      </Drawer>
      <PinDialog user={pinUser} onClose={() => setPinUser(null)} />
    </Stack>
  );
}
