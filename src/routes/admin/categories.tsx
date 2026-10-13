import { Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/categories')({
  component: () => <Title order={3}>Categories</Title>,
});
