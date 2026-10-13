import { Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/admin/warehouses/$warehouseId/locations',
)({
  component: () => <Title order={3}>Locations</Title>,
});
