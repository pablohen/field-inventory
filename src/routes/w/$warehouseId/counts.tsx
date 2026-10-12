import { Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/w/$warehouseId/counts')({
  component: () => <Title order={3}>Counts</Title>,
});
