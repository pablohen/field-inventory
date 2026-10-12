import { Container, Stack, Title } from '@mantine/core';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { SignOutButton } from '#/desk/components/SignOutButton';
import { deskHomeTarget } from '#/desk/home-target';
import { getDeskSession, getWarehouses } from '#/server/desk/desk-auth.fn';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const session = await getDeskSession();
    const warehouses = session ? await getWarehouses() : [];
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
