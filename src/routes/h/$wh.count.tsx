import { NativeSelect, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ConfirmButton,
  RecordStatus,
} from '#/handheld/components/ConfirmButton';
import { QtyInput } from '#/handheld/components/QtyInput';
import { ScanStep } from '#/handheld/components/ScanStep';
import { ScreenFrame } from '#/handheld/components/ScreenFrame';
import { useHandheld } from '#/handheld/context';
import { getCachedSession } from '#/handheld/session-store';
import {
  type FoundLocation,
  type FoundProduct,
  useLookups,
} from '#/handheld/use-lookups';
import { useRecorder } from '#/handheld/use-recorder';

export const Route = createFileRoute('/h/$wh/count')({ component: CountPage });

function CountPage() {
  const { wh } = Route.useParams();
  return (
    <ScreenFrame wh={wh} title="Count">
      <CountFlow wh={wh} />
    </ScreenFrame>
  );
}

/** Blind count: this screen never reads or shows the expected quantity or balance. */
export function CountFlow({ wh }: { wh: string }) {
  const { backend } = useHandheld();
  const lookups = useLookups(wh);
  const rec = useRecorder(wh);
  const userId = getCachedSession()?.userId;
  const [taskId, setTaskId] = useState('');
  const [loc, setLoc] = useState<FoundLocation | null>(null);
  const [product, setProduct] = useState<FoundProduct | null>(null);
  const [qty, setQty] = useState<number | ''>('');

  const { data: tasks } = useQuery({
    queryKey: ['h', wh, 'countTasks', userId],
    queryFn: () =>
      (backend as NonNullable<typeof backend>).call(
        'assignedCountTasks',
        wh,
        userId as string,
      ),
    enabled: backend !== null && userId !== undefined,
  });

  const reset = () => {
    setLoc(null);
    setProduct(null);
    setQty('');
  };

  const confirm = () => {
    if (!loc || !product) return;
    if (qty === '' || qty < 0) {
      rec.setError('Enter the counted quantity (0 or more)');
      return;
    }
    rec.submit(
      'COUNT',
      {
        skuId: product.id,
        locationId: loc.id,
        qty,
        ...(taskId ? { ref: taskId } : {}),
      },
      reset,
    );
  };

  return (
    <Stack>
      {tasks && tasks.length > 0 && (
        <NativeSelect
          label="Count task (optional)"
          value={taskId}
          onChange={(e) => setTaskId(e.currentTarget.value)}
          data={[
            { value: '', label: 'No task' },
            ...tasks.map((t) => ({
              value: t.id,
              label: `${t.id} (${t.status})`,
            })),
          ]}
        />
      )}
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
          <QtyInput
            label="Counted quantity"
            min={0}
            value={qty}
            onChange={setQty}
            onEnter={confirm}
          />
          <ConfirmButton
            onConfirm={confirm}
            isPending={rec.isPending}
            label="Confirm count"
          />
        </>
      )}
      <RecordStatus error={rec.error} recorded={rec.recorded} />
    </Stack>
  );
}
