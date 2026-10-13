import { Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/admin/reason-codes')({
  component: () => <Title order={3}>Reason codes</Title>,
});
