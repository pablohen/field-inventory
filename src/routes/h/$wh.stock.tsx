import { Anchor, Title } from '@mantine/core';
import { createFileRoute, Link } from '@tanstack/react-router';
import { StockView } from '#/handheld/components/StockView';

export const Route = createFileRoute('/h/$wh/stock')({ component: StockPage });

function StockPage() {
  const { wh } = Route.useParams();
  return (
    <>
      <Anchor component={Link} to="/h">
        Warehouses
      </Anchor>
      <Title order={4}>Stock in {wh}</Title>
      <StockView wh={wh} />
    </>
  );
}
