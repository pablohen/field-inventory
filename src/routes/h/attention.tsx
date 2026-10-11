import { Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { AttentionView } from '#/handheld/components/AttentionView';

export const Route = createFileRoute('/h/attention')({
  component: () => (
    <>
      <Title order={4}>Needs attention</Title>
      <AttentionView />
    </>
  ),
});
