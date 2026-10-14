import { Anchor, Title } from '@mantine/core';
import { ArrowLeftIcon } from '@phosphor-icons/react';
import { createFileRoute, Link } from '@tanstack/react-router';
import { StockView } from '#/handheld/components/StockView';
import { TOUCH } from '#/handheld/touch';

export const Route = createFileRoute('/h/$wh/stock')({ component: StockPage });

function StockPage() {
  const { wh } = Route.useParams();
  return (
    <>
      <Anchor
        component={Link}
        to="/h"
        style={{
          ...TOUCH,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        <ArrowLeftIcon size={16} weight="bold" aria-hidden="true" />
        Warehouses
      </Anchor>
      <Title order={4}>Stock in {wh}</Title>
      <StockView wh={wh} />
    </>
  );
}
