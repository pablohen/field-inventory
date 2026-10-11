import { Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/')({ component: Home });

function Home() {
  return <Title>Field Inventory</Title>;
}
