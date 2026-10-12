import { Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/w/$warehouseId/stock')({
  component: () => <Title order={3}>Stock</Title>,
});
