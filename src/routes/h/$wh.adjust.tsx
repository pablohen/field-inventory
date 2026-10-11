import { NativeSelect, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ConfirmButton,
  RecordStatus,
} from '#/handheld/components/ConfirmButton';
import { DisplayedQty } from '#/handheld/components/DisplayedQty';
import { QtyInput } from '#/handheld/components/QtyInput';
import { ScanStep } from '#/handheld/components/ScanStep';
import { ScreenFrame } from '#/handheld/components/ScreenFrame';
import { useHandheld } from '#/handheld/context';
import {
  type FoundLocation,
  type FoundProduct,
  useLookups,
} from '#/handheld/use-lookups';
import { useRecorder } from '#/handheld/use-recorder';

export const Route = createFileRoute('/h/$wh/adjust')({
  component: AdjustPage,
});

/** System-generated codes are never offered to a person. */
const SYSTEM_REASONS = new Set(['COUNT_AUTO', 'INITIAL']);

function AdjustPage() {
  const { wh } = Route.useParams();
  return (
    <ScreenFrame wh={wh} title="Adjust">
      <AdjustFlow wh={wh} />
    </ScreenFrame>
  );
}

export function AdjustFlow({ wh }: { wh: string }) {
  const { backend } = useHandheld();
  const lookups = useLookups(wh);
  const rec = useRecorder(wh);
  const [loc, setLoc] = useState<FoundLocation | null>(null);
  const [product, setProduct] = useState<FoundProduct | null>(null);
  const [qty, setQty] = useState<number | ''>('');
  const [reason, setReason] = useState('');

  const { data: reasons } = useQuery({
    queryKey: ['h', 'reasonCodes', 'ADJUST'],
    queryFn: () =>
      (backend as NonNullable<typeof backend>).call('reasonCodes', 'ADJUST'),
    enabled: backend !== null,
  });

  const reset = () => {
    setLoc(null);
    setProduct(null);
    setQty('');
    setReason('');
  };

  const confirm = () => {
    if (!loc || !product) return;
    if (qty === '' || qty === 0) {
      rec.setError('Enter a quantity other than 0 (negative removes stock)');
      return;
    }
    if (reason === '') {
      rec.setError('Reason is required');
      return;
    }
    rec.submit(
      'ADJUST',
      {
        skuId: product.id,
        locationId: loc.id,
        qty,
        reasonCode: reason,
      },
      reset,
    );
  };

  return (
    <Stack>
      {loc && <Text>Location: {loc.code}</Text>}
      {product && (
        <Text>
          Product: {product.sku} {product.name}
        </Text>
      )}
      {!loc && (
        <ScanStep
          key="loc"
          label="Scan location"
          onScan={async (v) => {
            const r = await lookups.location(v);
            if (!r.ok) return r.error;
            rec.clearRecorded();
            setLoc(r.value);
            return null;
          }}
        />
      )}
      {loc && !product && (
        <ScanStep
          key="product"
          label="Scan product"
          onScan={async (v) => {
            const r = await lookups.product(v);
            if (!r.ok) return r.error;
            setProduct(r.value);
            return null;
          }}
        />
      )}
      {loc && product && (
        <>
          <DisplayedQty wh={wh} skuId={product.id} locationId={loc.id} />
          <QtyInput
            label="Adjustment (negative removes)"
            allowNegative
            value={qty}
            onChange={setQty}
            onEnter={confirm}
          />
          <NativeSelect
            label="Reason"
            value={reason}
            onChange={(e) => setReason(e.currentTarget.value)}
            data={[
              { value: '', label: 'Choose a reason' },
              ...(reasons ?? [])
                .filter((r) => !SYSTEM_REASONS.has(r.code))
                .map((r) => ({ value: r.code, label: r.label })),
            ]}
          />
          <ConfirmButton
            onConfirm={confirm}
            isPending={rec.isPending}
            label="Confirm adjustment"
          />
        </>
      )}
      <RecordStatus error={rec.error} recorded={rec.recorded} />
    </Stack>
  );
}
