import { Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/w/$warehouseId/pick-lists')({
  component: () => <Title order={3}>Pick lists</Title>,
});
