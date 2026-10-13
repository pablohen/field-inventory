import { Loader, Stack, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { ReasonCodeTable } from '#/admin/components/ReasonCodeTable';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { errorMessage, RefreshNote } from '#/desk/components/RefreshNote';
import { deskCall } from '#/desk/desk-call';
import { listReasonCodesAdmin } from '#/server/admin/catalog.fn';

export const Route = createFileRoute('/admin/reason-codes')({
  component: ReasonCodesPage,
});

export function ReasonCodesPage() {
  const list = useQuery({
    queryKey: ['admin', 'reason-codes'],
    queryFn: () => deskCall(listReasonCodesAdmin),
  });
  return (
    <Stack>
      <Title order={3}>Reason codes</Title>
      {list.isError && list.data && <RefreshNote />}
      {list.data ? (
        <ReasonCodeTable rows={list.data} />
      ) : list.isError ? (
        <DeskErrorAlert
          error={{ code: 'INVALID', message: errorMessage(list.error) }}
        />
      ) : (
        <Loader size="sm" />
      )}
    </Stack>
  );
}
