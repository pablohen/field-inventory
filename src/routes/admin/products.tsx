import {
  Alert,
  Button,
  Drawer,
  Group,
  Loader,
  Stack,
  TextInput,
  Title,
} from '@mantine/core';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  createFileRoute,
  useNavigate,
  useSearch,
} from '@tanstack/react-router';
import { useState } from 'react';
import { parseProductSearch } from '#/admin/catalog-input';
import { ProductForm } from '#/admin/components/ProductForm';
import { ProductTable } from '#/admin/components/ProductTable';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { errorMessage, RefreshNote } from '#/desk/components/RefreshNote';
import { deskCall } from '#/desk/desk-call';
import { listCategories, listProducts } from '#/server/admin/catalog.fn';
import type { ProductRow } from '#/server/admin/catalog.server';

export const Route = createFileRoute('/admin/products')({
  validateSearch: parseProductSearch,
  component: ProductsPage,
});

export function ProductsPage() {
  // strict:false may expose the raw URL search, so re-validate defensively.
  const search = parseProductSearch(useSearch({ strict: false })).search ?? '';
  const navigate = useNavigate();
  const [text, setText] = useState(search);
  const [drawer, setDrawer] = useState<{ row: ProductRow | null } | null>(null);
  const list = useQuery({
    queryKey: ['admin', 'products', search],
    queryFn: () => deskCall(listProducts, search ? { search } : {}),
    placeholderData: keepPreviousData,
  });
  const categories = useQuery({
    queryKey: ['admin', 'categories'],
    queryFn: () => deskCall(listCategories),
  });

  function apply() {
    const next = text.trim();
    void navigate({
      to: '.',
      search: (() => (next ? { search: next } : {})) as never,
    });
  }

  return (
    <Stack>
      <Group justify="space-between">
        <Title order={3}>Products</Title>
        <Button onClick={() => setDrawer({ row: null })}>New product</Button>
      </Group>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply();
        }}
      >
        <Group align="flex-end">
          <TextInput
            label="Search"
            placeholder="SKU, name or barcode"
            value={text}
            onChange={(e) => setText(e.currentTarget.value)}
          />
          <Button type="submit" variant="default">
            Search
          </Button>
        </Group>
      </form>
      {list.isError && list.data && <RefreshNote />}
      {list.data ? (
        <ProductTable rows={list.data} onEdit={(row) => setDrawer({ row })} />
      ) : list.isError ? (
        <DeskErrorAlert
          error={{ code: 'INVALID', message: errorMessage(list.error) }}
        />
      ) : (
        <Loader size="sm" />
      )}
      <Drawer
        opened={drawer !== null}
        onClose={() => setDrawer(null)}
        position="right"
        size="lg"
        title={drawer?.row ? `Edit ${drawer.row.sku}` : 'New product'}
      >
        {drawer &&
          (categories.data ? (
            <ProductForm
              key={drawer.row?.id ?? 'new'}
              product={drawer.row}
              categories={categories.data}
              onDone={() => setDrawer(null)}
            />
          ) : categories.isError ? (
            <Alert color="red" role="alert">
              {errorMessage(categories.error)}
            </Alert>
          ) : (
            <Loader size="sm" />
          ))}
      </Drawer>
    </Stack>
  );
}
