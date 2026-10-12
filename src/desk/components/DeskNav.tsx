import { Group, Select } from '@mantine/core';
import { Link, useNavigate } from '@tanstack/react-router';

const LINKS = [
  { to: '/w/$warehouseId/exceptions', label: 'Exceptions', seg: 'exceptions' },
  { to: '/w/$warehouseId/stock', label: 'Stock', seg: 'stock' },
  { to: '/w/$warehouseId/pick-lists', label: 'Pick lists', seg: 'pick-lists' },
  { to: '/w/$warehouseId/counts', label: 'Counts', seg: 'counts' },
] as const;

/** Swaps the warehouse segment of `/w/<id>/<page>`, keeping the page. */
export function switchWarehousePath(pathname: string, id: string): string {
  const m = pathname.match(/^\/w\/[^/]+(\/.*)?$/);
  return `/w/${encodeURIComponent(id)}${m?.[1] ?? '/exceptions'}`;
}

export function DeskNav({
  warehouseId,
  warehouses,
  pathname,
}: {
  warehouseId: string;
  warehouses: { id: string; name: string }[];
  pathname: string;
}) {
  const navigate = useNavigate();
  return (
    <Group gap="md" wrap="wrap">
      <Select
        aria-label="Warehouse"
        w={200}
        allowDeselect={false}
        data={warehouses.map((w) => ({ value: w.id, label: w.name }))}
        value={warehouseId}
        onChange={(id) => {
          if (id && id !== warehouseId) {
            void navigate({ to: switchWarehousePath(pathname, id) });
          }
        }}
      />
      {LINKS.map((l) => (
        <Link
          key={l.seg}
          to={l.to}
          params={{ warehouseId }}
          activeProps={{ style: { fontWeight: 700 } }}
        >
          {l.label}
        </Link>
      ))}
    </Group>
  );
}
