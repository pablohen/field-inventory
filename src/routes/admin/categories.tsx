import { Loader, Stack, Title } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { CategoryTable } from '#/admin/components/CategoryTable';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { errorMessage, RefreshNote } from '#/desk/components/RefreshNote';
import { deskCall } from '#/desk/desk-call';
import { listCategories } from '#/server/admin/catalog.fn';

export const Route = createFileRoute('/admin/categories')({
  component: CategoriesPage,
});

export function CategoriesPage() {
  const list = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => deskCall(listCategories),
  });
  return (
    <Stack>
      <Title order={3}>Categories</Title>
      {list.isError && list.data && <RefreshNote />}
      {list.data ? (
        <CategoryTable rows={list.data} />
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
