import { Alert, Button, Card, Stack, Switch, Text } from '@mantine/core';
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
import { TOUCH } from '#/handheld/touch';
import { useLookups } from '#/handheld/use-lookups';
import { useRecorder } from '#/handheld/use-recorder';

export const Route = createFileRoute('/h/$wh/pick')({ component: PickPage });

function PickPage() {
  const { wh } = Route.useParams();
  return (
    <ScreenFrame wh={wh} title="Pick">
      <PickFlow wh={wh} />
    </ScreenFrame>
  );
}

export function PickFlow({ wh }: { wh: string }) {
  const { backend } = useHandheld();
  const lookups = useLookups(wh);
  const rec = useRecorder(wh);
  const userId = getCachedSession()?.userId;
  const listsKey = ['h', wh, 'pickLists', userId] as const;
  const [listId, setListId] = useState<string | null>(null);
  const [lineId, setLineId] = useState<string | null>(null);
  const [showCompleted, setShowCompleted] = useState(false);
  const [locOk, setLocOk] = useState(false);
  const [productOk, setProductOk] = useState(false);
  const [qty, setQty] = useState<number | ''>('');

  const { data: lists, error } = useQuery({
    queryKey: listsKey,
    queryFn: () =>
      (backend as NonNullable<typeof backend>).call(
        'assignedPickLists',
        wh,
        userId as string,
      ),
    enabled: backend !== null && userId !== undefined,
  });

  const list = lists?.find((l) => l.id === listId) ?? null;
  const remainingOf = (l: { qtyRequested: number; pickedQty: number }) =>
    l.qtyRequested - l.pickedQty;
  const lines = list?.lines ?? [];
  const visible = lines.filter((l) => showCompleted || remainingOf(l) > 0);
  const line =
    lines.find((l) => l.id === lineId) ??
    lines.find((l) => remainingOf(l) > 0) ??
    null;

  const resetLine = () => {
    setLineId(null);
    setLocOk(false);
    setProductOk(false);
    setQty('');
  };

  const confirm = () => {
    if (!line || !locOk || !productOk) return;
    if (qty === '' || qty <= 0) {
      rec.setError('Enter a quantity above 0');
      return;
    }
    const picked = qty;
    rec.submit(
      'PICK',
      {
        skuId: line.skuId,
        fromLocationId: line.locationId,
        qty: picked,
        ref: line.id,
      },
      () => {
        resetLine();
      },
    );
  };

  if (!list) {
    return (
      <Stack>
        {error && <Text c="red">Could not load pick lists</Text>}
        {lists && lists.length === 0 && (
          <Text c="dimmed">No pick lists assigned</Text>
        )}
        {(lists ?? []).map((l) => (
          <Card key={l.id} withBorder>
            <Stack gap="xs">
              <Text>
                {l.id} ({l.lines.length} lines)
              </Text>
              <Button
                style={TOUCH}
                size="compact-md"
                onClick={() => {
                  rec.clearRecorded();
                  setListId(l.id);
                  resetLine();
                }}
              >
                Start
              </Button>
            </Stack>
          </Card>
        ))}
        <RecordStatus error={rec.error} recorded={rec.recorded} />
      </Stack>
    );
  }

  return (
    <Stack>
      <Button
        style={TOUCH}
        size="compact-sm"
        variant="subtle"
        onClick={() => {
          setListId(null);
          resetLine();
        }}
      >
        Choose another list
      </Button>
      <Switch
        label="Show completed"
        checked={showCompleted}
        onChange={(e) => setShowCompleted(e.currentTarget.checked)}
      />
      {visible.map((l) => (
        <Card key={l.id} withBorder padding="xs">
          <Text size="sm" fw={l.id === line?.id ? 700 : 400}>
            {l.skuId} at {l.locationId}: {l.pickedQty}/{l.qtyRequested}
          </Text>
          {l.id !== line?.id && (
            <Button
              style={TOUCH}
              size="compact-xs"
              variant="subtle"
              onClick={() => {
                resetLine();
                setLineId(l.id);
              }}
            >
              Work on this line
            </Button>
          )}
        </Card>
      ))}
      {!line && <Text c="dimmed">All lines picked</Text>}
      {line && (
        <Stack key={line.id}>
          <Text fw={600}>
            Pick {line.skuId} from {line.locationId}
          </Text>
          {!locOk && (
            <ScanStep
              key="loc"
              label="Scan location"
              onScan={async (v) => {
                const r = await lookups.location(v);
                if (!r.ok) return r.error;
                if (r.value.id !== line.locationId) return 'Wrong location';
                rec.clearRecorded();
                setLocOk(true);
                return null;
              }}
            />
          )}
          {locOk && !productOk && (
            <ScanStep
              key="product"
              label="Scan product"
              onScan={async (v) => {
                const r = await lookups.product(v);
                if (!r.ok) return r.error;
                if (r.value.id !== line.skuId) return 'Wrong product';
                setProductOk(true);
                setQty(Math.max(remainingOf(line), 1));
                return null;
              }}
            />
          )}
          {locOk && productOk && (
            <>
              <QtyInput
                min={1}
                value={qty}
                onChange={setQty}
                onEnter={confirm}
              />
              {qty !== '' && qty > remainingOf(line) && (
                <Alert color="yellow">More than requested</Alert>
              )}
              <ConfirmButton
                onConfirm={confirm}
                isPending={rec.isPending}
                label="Confirm pick"
              />
            </>
          )}
        </Stack>
      )}
      <RecordStatus error={rec.error} recorded={rec.recorded} />
    </Stack>
  );
}
