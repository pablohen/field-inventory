import { Alert, MultiSelect, Select, Stack } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { deskCall } from '#/desk/desk-call';
import { listProducts } from '#/server/admin/catalog.fn';
import type { ProductRow } from '#/server/admin/catalog.server';

type Common = {
  label: string;
  /** Overrides the accessible name when several pickers share a label. */
  ariaLabel?: string;
  disabled?: boolean;
  w?: number | string;
};
type SingleProps = Common & {
  multiple?: false;
  value: string | null;
  onChange: (productId: string | null) => void;
};
type MultiProps = Common & {
  multiple: true;
  value: string[];
  onChange: (productIds: string[]) => void;
};

const optionLabel = (p: Pick<ProductRow, 'sku' | 'name'>) =>
  `${p.sku} · ${p.name}`;

/**
 * Searchable product chooser. The value is the product id; options load from
 * `listProducts` (debounced). Selected products stay in the options with their
 * label even when the current search no longer returns them.
 */
export function ProductPicker(props: SingleProps | MultiProps) {
  const { label, ariaLabel, disabled, w } = props;
  const selected: string[] = props.multiple
    ? props.value
    : props.value
      ? [props.value]
      : [];
  const [typed, setTyped] = useState('');
  const known = useRef(new Map<string, string>());

  // After a pick, Mantine puts the option label into the input; that is not a
  // search term.
  const selectedLabel =
    !props.multiple && props.value ? known.current.get(props.value) : undefined;
  const term = typed === selectedLabel ? '' : typed.trim();
  const [search] = useDebouncedValue(term, 250);

  const query = useQuery({
    queryKey: ['desk', 'products', search],
    queryFn: () =>
      deskCall(listProducts, search ? { search } : ({} as { search?: string })),
    placeholderData: keepPreviousData,
    retry: false,
    refetchOnWindowFocus: false,
  });

  for (const p of query.data ?? []) known.current.set(p.id, optionLabel(p));
  const options = new Map<string, string>();
  for (const id of selected) options.set(id, known.current.get(id) ?? id);
  for (const p of query.data ?? []) {
    if (!options.has(p.id)) options.set(p.id, optionLabel(p));
  }
  const data = [...options].map(([value, text]) => ({ value, label: text }));
  const loadFailed = query.isError && !query.data;
  const nothingFoundMessage = query.isFetching ? 'Searching…' : 'No products';
  // The server already filtered by the search term.
  const passthrough = ({ options: o }: { options: unknown }) => o as never;

  return (
    <Stack gap={4}>
      {props.multiple ? (
        <MultiSelect
          label={label}
          aria-label={ariaLabel}
          searchable
          disabled={disabled}
          w={w}
          placeholder="Search SKU or name"
          nothingFoundMessage={nothingFoundMessage}
          data={data}
          filter={passthrough}
          onSearchChange={setTyped}
          value={props.value}
          onChange={props.onChange}
        />
      ) : (
        <Select
          label={label}
          aria-label={ariaLabel}
          searchable
          clearable
          disabled={disabled}
          w={w}
          placeholder="Search SKU or name"
          nothingFoundMessage={nothingFoundMessage}
          data={data}
          filter={passthrough}
          onSearchChange={setTyped}
          value={props.value}
          onChange={props.onChange}
        />
      )}
      {loadFailed && (
        <Alert color="red" role="alert" py={4}>
          Couldn't load products
        </Alert>
      )}
    </Stack>
  );
}
