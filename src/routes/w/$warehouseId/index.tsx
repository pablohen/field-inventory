import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/w/$warehouseId/')({
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/w/$warehouseId/exceptions',
      params: { warehouseId: params.warehouseId },
    });
  },
});
