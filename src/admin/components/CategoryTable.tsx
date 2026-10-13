import { Button, Table, TextInput } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { categoryInputSchema } from '#/admin/catalog-input';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { deskCall } from '#/desk/desk-call';
import { runMutation } from '#/desk/run-mutation';
import { createCategory, updateCategory } from '#/server/admin/catalog.fn';
import type { CategoryRow } from '#/server/admin/catalog.server';
import type { DeskError } from '#/server/desk/warehouses.server';
import { EmptyNote } from '#/ui/EmptyNote';

type Err = Pick<DeskError, 'code' | 'message'>;
type Fields = { name: string; countTolerance: number };

function useCategorySave(
  run: (data: Fields) => Promise<{ ok: true } | DeskError>,
) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<Err | null>(null);
  async function save(data: Fields, onOk?: () => void) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await runMutation(() => run(data), setError);
      if (res === undefined) return;
      await Promise.all([
        qc.invalidateQueries({ queryKey: ['admin', 'categories'] }),
        qc.invalidateQueries({ queryKey: ['admin', 'products'] }),
      ]);
      if (res.ok) onOk?.();
      else setError(res);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }
  return { save, pending, error };
}

function parseFields(name: string, tol: string) {
  const t = tol.trim();
  return categoryInputSchema.safeParse({
    name,
    countTolerance: t === '' ? Number.NaN : Number(t),
  });
}

export function CategoryTable({ rows }: { rows: CategoryRow[] }) {
  return (
    <Table.ScrollContainer minWidth={560}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Count tolerance</Table.Th>
            <Table.Th ta="right">Products</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          <NewCategoryRow />
          {rows.map((r) => (
            <CategoryRowView key={r.id} row={r} />
          ))}
          {rows.length === 0 && (
            <Table.Tr>
              <Table.Td colSpan={4}>
                <EmptyNote>No categories.</EmptyNote>
              </Table.Td>
            </Table.Tr>
          )}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function CategoryRowView({ row }: { row: CategoryRow }) {
  const [name, setName] = useState(row.name);
  const [tol, setTol] = useState(String(row.countTolerance));
  const { save, pending, error } = useCategorySave((data) =>
    deskCall(updateCategory, { categoryId: row.id, ...data }),
  );
  const parsed = parseFields(name, tol);
  const dirty = name !== row.name || tol !== String(row.countTolerance);
  return (
    <>
      <Table.Tr>
        <Table.Td>
          <TextInput
            aria-label={`Name ${row.name}`}
            value={name}
            disabled={pending}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </Table.Td>
        <Table.Td>
          <TextInput
            aria-label={`Tolerance ${row.name}`}
            inputMode="numeric"
            value={tol}
            disabled={pending}
            onChange={(e) => setTol(e.currentTarget.value)}
          />
        </Table.Td>
        <Table.Td ta="right">{row.productCount}</Table.Td>
        <Table.Td>
          <Button
            size="xs"
            aria-label={`Save ${row.name}`}
            disabled={pending || !dirty || !parsed.success}
            loading={pending}
            onClick={() => parsed.success && void save(parsed.data)}
          >
            Save
          </Button>
        </Table.Td>
      </Table.Tr>
      {error && (
        <Table.Tr>
          <Table.Td colSpan={4}>
            <DeskErrorAlert error={error} />
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}

function NewCategoryRow() {
  const [name, setName] = useState('');
  const [tol, setTol] = useState('');
  const { save, pending, error } = useCategorySave((data) =>
    deskCall(createCategory, data),
  );
  const parsed = parseFields(name, tol);
  return (
    <>
      <Table.Tr>
        <Table.Td>
          <TextInput
            aria-label="New category name"
            placeholder="New category"
            value={name}
            disabled={pending}
            onChange={(e) => setName(e.currentTarget.value)}
          />
        </Table.Td>
        <Table.Td>
          <TextInput
            aria-label="New category tolerance"
            inputMode="numeric"
            value={tol}
            disabled={pending}
            onChange={(e) => setTol(e.currentTarget.value)}
          />
        </Table.Td>
        <Table.Td />
        <Table.Td>
          <Button
            size="xs"
            disabled={pending || !parsed.success}
            loading={pending}
            onClick={() =>
              parsed.success &&
              void save(parsed.data, () => {
                setName('');
                setTol('');
              })
            }
          >
            Add category
          </Button>
        </Table.Td>
      </Table.Tr>
      {error && (
        <Table.Tr>
          <Table.Td colSpan={4}>
            <DeskErrorAlert error={error} />
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}
