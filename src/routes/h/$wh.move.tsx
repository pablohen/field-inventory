import { NativeSelect, SegmentedControl, Stack, Text } from '@mantine/core';
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
import { getCachedReplicaConfig } from '#/handheld/session-store';
import { TOUCH } from '#/handheld/touch';
import {
  type FoundLocation,
  type FoundProduct,
  useLookups,
} from '#/handheld/use-lookups';
import { useRecorder } from '#/handheld/use-recorder';

export const Route = createFileRoute('/h/$wh/move')({ component: MovePage });

const SAME = 'Destination must differ from source';

function MovePage() {
  const { wh } = Route.useParams();
  return (
    <ScreenFrame wh={wh} title="Move">
      <MoveFlow wh={wh} />
    </ScreenFrame>
  );
}

export function MoveFlow({ wh }: { wh: string }) {
  const lookups = useLookups(wh);
  const rec = useRecorder(wh);
  const [from, setFrom] = useState<FoundLocation | null>(null);
  const [product, setProduct] = useState<FoundProduct | null>(null);
  const [qty, setQty] = useState<number | ''>('');
  const [mode, setMode] = useState<'here' | 'other'>('here');
  const [to, setTo] = useState<FoundLocation | null>(null);
  const [otherWh, setOtherWh] = useState('');

  const otherWarehouses = (getCachedReplicaConfig()?.replicas ?? [])
    .map((r) => r.name)
    .filter((n) => n !== 'catalog' && n !== wh);

  const reset = () => {
    setFrom(null);
    setProduct(null);
    setQty('');
    setTo(null);
    setOtherWh('');
    setMode('here');
  };

  const confirm = () => {
    if (!from || !product) return;
    if (qty === '' || qty <= 0) {
      rec.setError('Enter a quantity above 0');
      return;
    }
    if (mode === 'here') {
      if (!to) {
        rec.setError('Scan the destination location');
        return;
      }
      if (to.id === from.id) {
        rec.setError(SAME);
        return;
      }
      rec.submit(
        'MOVE',
        {
          skuId: product.id,
          fromLocationId: from.id,
          toLocationId: to.id,
          qty,
        },
        reset,
      );
      return;
    }
    if (otherWh === '') {
      rec.setError('Choose the destination warehouse');
      return;
    }
    rec.submit(
      'TRANSFER_OUT',
      {
        skuId: product.id,
        fromLocationId: from.id,
        qty,
        transferId: crypto.randomUUID(),
        counterpartWarehouseId: otherWh,
      },
      reset,
    );
  };

  return (
    <Stack>
      {from && <Text>From: {from.code}</Text>}
      {product && (
        <Text>
          Product: {product.sku} {product.name}
        </Text>
      )}
      {!from && (
        <ScanStep
          key="from"
          label="Scan source location"
          onScan={async (v) => {
            const r = await lookups.location(v);
            if (!r.ok) return r.error;
            rec.clearRecorded();
            setFrom(r.value);
            return null;
          }}
        />
      )}
      {from && !product && (
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
      {from && product && (
        <>
          <DisplayedQty wh={wh} skuId={product.id} locationId={from.id} />
          <QtyInput min={1} value={qty} onChange={setQty} onEnter={confirm} />
          <SegmentedControl
            size="lg"
            styles={{
              control: TOUCH,
              label: {
                ...TOUCH,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              },
            }}
            value={mode}
            onChange={(v) => setMode(v as 'here' | 'other')}
            data={[
              { value: 'here', label: 'This warehouse' },
              { value: 'other', label: 'Other warehouse' },
            ]}
          />
          {mode === 'here' ? (
            <>
              {to && <Text>To: {to.code}</Text>}
              <ScanStep
                key="to"
                label="Scan destination location"
                onScan={async (v) => {
                  const r = await lookups.location(v);
                  setTo(null);
                  if (!r.ok) return r.error;
                  if (r.value.id === from.id) return SAME;
                  setTo(r.value);
                  return null;
                }}
              />
            </>
          ) : (
            <NativeSelect
              styles={{ input: TOUCH }}
              label="Destination warehouse"
              value={otherWh}
              onChange={(e) => setOtherWh(e.currentTarget.value)}
              data={[
                { value: '', label: 'Choose a warehouse' },
                ...otherWarehouses.map((n) => ({ value: n, label: n })),
              ]}
            />
          )}
          <ConfirmButton
            onConfirm={confirm}
            isPending={rec.isPending}
            label={mode === 'here' ? 'Confirm move' : 'Confirm transfer out'}
          />
        </>
      )}
      <RecordStatus error={rec.error} recorded={rec.recorded} />
    </Stack>
  );
}
