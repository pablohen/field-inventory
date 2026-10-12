import { Container, Title } from '@mantine/core';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { deskHomeTarget } from '#/desk/home-target';
import { getDeskSession, getWarehouses } from '#/server/desk/desk-auth.fn';

export const Route = createFileRoute('/')({
  beforeLoad: async () => {
    const session = await getDeskSession();
    const warehouses = session ? await getWarehouses() : [];
    const target = deskHomeTarget(session, warehouses);
    if (target) throw redirect({ href: target });
  },
  component: Home,
});

function Home() {
  return (
    <Container py="xl">
      <Title order={3}>No warehouses yet</Title>
    </Container>
  );
}
