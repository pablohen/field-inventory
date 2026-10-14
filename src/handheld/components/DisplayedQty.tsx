import { Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { useHandheld } from '../context';
import { stockKey } from '../record';

/** Displayed (synced plus pending) quantity of a product at a location. Never used by Count. */
export function DisplayedQty({
  wh,
  skuId,
  locationId,
}: {
  wh: string;
  skuId: string;
  locationId: string;
}) {
  const { backend } = useHandheld();
  const filter = { skuId, locationId };
  const { data, error } = useQuery({
    queryKey: stockKey(wh, filter),
    queryFn: () =>
      (backend as NonNullable<typeof backend>).call(
        'displayedStock',
        wh,
        filter,
      ),
    enabled: backend !== null,
  });
  if (error)
    return (
      <Text style={{ color: 'var(--fi-danger)' }}>Could not load quantity</Text>
    );
  if (!data) return <Text c="dimmed">Loading quantity…</Text>;
  const row = data.find(
    (r) => r.skuId === skuId && r.locationId === locationId,
  );
  return (
    <Text fz={40} fw={800} lh={1.1} className="fi-num">
      On hand: {row?.qty ?? 0}
    </Text>
  );
}
