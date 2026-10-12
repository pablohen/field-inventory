import { Container, Stack, Title } from '@mantine/core';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { isDeskAuthError } from '#/desk/auth-error';
import { SignOutButton } from '#/desk/components/SignOutButton';
import { deskCall } from '#/desk/desk-call';
import { deskHomeTarget } from '#/desk/home-target';
import { getDeskSession, getWarehouses } from '#/server/desk/desk-auth.fn';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const session = await deskCall(getDeskSession);
    let warehouses: { id: string }[] = [];
    if (session) {
      try {
        const res = await deskCall(getWarehouses);
        warehouses = Array.isArray(res) ? res : [];
      } catch (err) {
        if (isDeskAuthError(err)) throw redirect({ to: '/desk/login' });
        throw err;
      }
    }
    const target = deskHomeTarget(session, warehouses);
    if (target === '/desk/login') throw redirect({ to: '/desk/login' });
    const first = warehouses[0];
    if (target && first) {
      throw redirect({
        to: '/w/$warehouseId/exceptions',
        params: { warehouseId: first.id },
      });
    }
  },
  component: Home,
});

function Home() {
  return (
    <Container py="xl">
      <Stack align="flex-start">
        <Title order={3}>No warehouses yet</Title>
        <SignOutButton />
      </Stack>
    </Container>
  );
}
