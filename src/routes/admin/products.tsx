import { Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/products')({
  component: () => <Title order={3}>Products</Title>,
});
