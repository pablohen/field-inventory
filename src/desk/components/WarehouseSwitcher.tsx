import { Select } from '@mantine/core';
import { useNavigate } from '@tanstack/react-router';

/** Swaps the warehouse segment of `/w/<id>/<page>`, keeping the page. */
export function switchWarehousePath(pathname: string, id: string): string {
  const m = pathname.match(/^\/w\/[^/]+(\/.*)?$/);
  return `/w/${encodeURIComponent(id)}${m?.[1] ?? '/exceptions'}`;
}

export function WarehouseSwitcher({
  warehouseId,
  warehouses,
  pathname,
}: {
  warehouseId: string;
  warehouses: { id: string; name: string }[];
  pathname: string;
}) {
  const navigate = useNavigate();
  const current = warehouses.find((w) => w.id === warehouseId)?.name;
  return (
    <Select
      aria-label="Warehouse"
      title={current}
      allowDeselect={false}
      data={warehouses.map((w) => ({ value: w.id, label: w.name }))}
      value={warehouseId}
      onChange={(id) => {
        if (id && id !== warehouseId) {
          void navigate({ to: switchWarehousePath(pathname, id) });
        }
      }}
    />
  );
}
