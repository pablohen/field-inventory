import { Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/w/$warehouseId/exceptions')({
  component: () => <Title order={3}>Exceptions</Title>,
});
