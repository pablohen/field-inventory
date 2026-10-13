import { Button, Select, Stack, TagsInput, TextInput } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { productInputSchema } from '#/admin/catalog-input';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { deskCall } from '#/desk/desk-call';
import { createProduct, updateProduct } from '#/server/admin/catalog.fn';
import type { CategoryRow, ProductRow } from '#/server/admin/catalog.server';
import type { DeskError } from '#/server/desk/warehouses.server';

export function ProductForm({
  product,
  categories,
  onDone,
}: {
  product?: ProductRow | null;
  categories: CategoryRow[];
  onDone: () => void;
}) {
  const qc = useQueryClient();
  const [sku, setSku] = useState(product?.sku ?? '');
  const [name, setName] = useState(product?.name ?? '');
  const [barcodes, setBarcodes] = useState<string[]>(product?.barcodes ?? []);
  const [uom, setUom] = useState(product?.uom ?? 'EA');
  const [categoryId, setCategoryId] = useState<string | null>(
    product?.categoryId ?? null,
  );
  const [tolerance, setTolerance] = useState(
    product?.countTolerance != null ? String(product.countTolerance) : '',
  );
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<Pick<
    DeskError,
    'code' | 'message'
  > | null>(null);

  const tolTrim = tolerance.trim();
  const tolNum = tolTrim === '' ? null : Number(tolTrim);
  const tolValid = tolNum === null || Number.isInteger(tolNum);
  const parsed = productInputSchema.safeParse({
    sku,
    name,
    barcodes,
    uom,
    categoryId,
    countTolerance: tolNum,
  });

  async function submit() {
    if (!parsed.success || !tolValid || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = product
        ? await deskCall(updateProduct, {
            productId: product.id,
            ...parsed.data,
          })
        : await deskCall(createProduct, parsed.data);
      await qc.invalidateQueries({ queryKey: ['admin', 'products'] });
      if (res.ok) onDone();
      else setError(res);
    } catch (err) {
      setError({
        code: 'INVALID',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Stack gap="sm">
      <TextInput
        label="SKU"
        value={sku}
        disabled={pending}
        error={
          sku !== '' && !productInputSchema.shape.sku.safeParse(sku).success
            ? 'Letters, digits and dashes; up to 32 characters'
            : undefined
        }
        onChange={(e) => setSku(e.currentTarget.value)}
      />
      <TextInput
        label="Name"
        value={name}
        disabled={pending}
        onChange={(e) => setName(e.currentTarget.value)}
      />
      <TagsInput
        label="Barcodes"
        description="4 to 32 letters or digits each; up to 10."
        value={barcodes}
        disabled={pending}
        onChange={setBarcodes}
      />
      <TextInput
        label="UoM"
        value={uom}
        disabled={pending}
        onChange={(e) => setUom(e.currentTarget.value)}
      />
      <Select
        label="Category"
        clearable
        data={categories.map((c) => ({ value: c.id, label: c.name }))}
        value={categoryId}
        disabled={pending}
        onChange={setCategoryId}
      />
      <TextInput
        label="Count tolerance"
        description="Leave blank to use the category tolerance."
        inputMode="numeric"
        value={tolerance}
        disabled={pending}
        error={tolValid ? undefined : 'Whole number'}
        onChange={(e) => setTolerance(e.currentTarget.value)}
      />
      {error && <DeskErrorAlert error={error} />}
      <Button
        onClick={() => void submit()}
        disabled={pending || !parsed.success || !tolValid}
        loading={pending}
      >
        {product ? 'Save product' : 'Create product'}
      </Button>
    </Stack>
  );
}
