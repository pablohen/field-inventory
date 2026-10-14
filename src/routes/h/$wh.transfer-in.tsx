import { Button, Card, Stack, Text } from '@mantine/core';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import {
  ConfirmButton,
  RecordStatus,
} from '#/handheld/components/ConfirmButton';
import { ScanStep } from '#/handheld/components/ScanStep';
import { ScreenFrame } from '#/handheld/components/ScreenFrame';
import { useHandheld } from '#/handheld/context';
import { TOUCH } from '#/handheld/touch';
import { type FoundLocation, useLookups } from '#/handheld/use-lookups';
import { useRecorder } from '#/handheld/use-recorder';

export const Route = createFileRoute('/h/$wh/transfer-in')({
  component: TransferInPage,
});

function TransferInPage() {
  const { wh } = Route.useParams();
  return (
    <ScreenFrame wh={wh} title="Transfer in">
      <TransferInFlow wh={wh} />
    </ScreenFrame>
  );
}

export function TransferInFlow({ wh }: { wh: string }) {
  const { backend } = useHandheld();
  const lookups = useLookups(wh);
  const rec = useRecorder(wh);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [loc, setLoc] = useState<FoundLocation | null>(null);

  const { data, error } = useQuery({
    queryKey: ['h', wh, 'inTransit'],
    queryFn: () =>
      (backend as NonNullable<typeof backend>).call('inTransitTo', wh),
    enabled: backend !== null,
  });
  // A transfer without a reference cannot be matched to its receipt.
  const transfers = (data ?? []).filter((t) => t.ref !== null);
  const chosen = transfers.find((t) => t.movementId === chosenId) ?? null;

  const reset = () => {
    setChosenId(null);
    setLoc(null);
  };

  const confirm = () => {
    if (!chosen || !loc || chosen.ref === null) return;
    rec.submit(
      'TRANSFER_IN',
      {
        skuId: chosen.skuId,
        toLocationId: loc.id,
        qty: chosen.qty,
        transferId: chosen.ref,
        counterpartWarehouseId: chosen.fromWarehouseId,
      },
      reset,
    );
  };

  return (
    <Stack>
      {error && (
        <Text style={{ color: 'var(--fi-danger)' }}>
          Could not load transfers
        </Text>
      )}
      {!chosen && data && transfers.length === 0 && (
        <Text c="dimmed">Nothing in transit</Text>
      )}
      {!chosen &&
        transfers.map((t) => (
          <Card key={t.movementId} withBorder>
            <Stack gap="xs">
              <Text>
                {t.skuId} x {t.qty} from {t.fromWarehouseId}
              </Text>
              <Button
                style={TOUCH}
                size="compact-md"
                onClick={() => {
                  rec.clearRecorded();
                  setChosenId(t.movementId);
                }}
              >
                Receive
              </Button>
            </Stack>
          </Card>
        ))}
      {chosen && (
        <Text>
          Receiving {chosen.skuId} x {chosen.qty} from {chosen.fromWarehouseId}
        </Text>
      )}
      {chosen && !loc && (
        <ScanStep
          key="loc"
          label="Scan destination location"
          onScan={async (v) => {
            const r = await lookups.location(v);
            if (!r.ok) return r.error;
            setLoc(r.value);
            return null;
          }}
        />
      )}
      {chosen && loc && (
        <>
          <Text>To: {loc.code}</Text>
          <ConfirmButton
            onConfirm={confirm}
            isPending={rec.isPending}
            label="Confirm receipt"
          />
        </>
      )}
      <RecordStatus error={rec.error} recorded={rec.recorded} />
    </Stack>
  );
}
