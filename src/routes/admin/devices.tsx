import { Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/devices')({
  component: () => <Title order={3}>Devices</Title>,
});
