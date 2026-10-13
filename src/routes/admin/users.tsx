import { Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/users')({
  component: () => <Title order={3}>Users</Title>,
});
