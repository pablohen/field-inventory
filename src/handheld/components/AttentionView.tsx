import { Alert, Button, Card, Group, Modal, Stack, Text } from '@mantine/core';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useHandheld } from '../context';
import type { OutboxRow } from '../outbox';
import { getDeviceId } from '../session-store';

export function exportFilename(deviceId: string, now: Date): string {
  return `outbox-${deviceId}-${now.toISOString().slice(0, 10)}.json`;
}

function describe(row: OutboxRow): string {
  if ('corrupt' in row) return 'Unreadable record';
  return `${row.input.type} in ${row.warehouseId}`;
}

export function AttentionView() {
  const { backend, syncState, session } = useHandheld();
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState<OutboxRow | null>(null);
  const [error, setError] = useState('');

  const blocked =
    syncState?.phase === 'device_revoked' ||
    syncState?.phase === 'device_unknown';

  const { data: pendingRows } = useQuery({
    queryKey: ['h', 'attention', 'pending'],
    queryFn: () =>
      (backend as NonNullable<typeof backend>).call('listOutbox', {
        status: 'pending',
      }),
    enabled: backend !== null && blocked,
  });

  const { data } = useQuery({
    queryKey: ['h', 'attention'],
    queryFn: () =>
      (backend as NonNullable<typeof backend>).call('listOutbox', {
        status: 'needs_attention',
      }),
    enabled: backend !== null,
  });

  const discard = async () => {
    if (!backend || !confirming) return;
    setError('');
    try {
      await backend.call('discardOutbox', confirming.id);
      setConfirming(null);
      await queryClient.invalidateQueries({ queryKey: ['h'] });
    } catch (err) {
      // Close the modal so the alert is visible.
      setConfirming(null);
      setError(
        `Could not discard: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  const exportAll = async () => {
    if (!backend) return;
    setError('');
    try {
      const json = await backend.call('exportOutbox');
      const deviceId = session?.deviceId ?? getDeviceId() ?? 'device';
      const url = URL.createObjectURL(
        new Blob([json], { type: 'application/json' }),
      );
      const a = document.createElement('a');
      a.href = url;
      a.download = exportFilename(deviceId, new Date());
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (err) {
      setError(
        `Could not export: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <Stack>
      {blocked && (
        <Alert
          color="red"
          title={
            syncState?.phase === 'device_revoked'
              ? 'This device was revoked'
              : "This device isn't enrolled"
          }
        >
          <Stack gap="xs">
            <span>Export the outbox so the records are not lost.</span>
            <Button onClick={() => void exportAll()}>Export outbox</Button>
          </Stack>
        </Alert>
      )}
      {error && <Alert color="red">{error}</Alert>}
      {(data ?? []).length === 0 && !blocked && (
        <Text c="dimmed">Nothing needs attention</Text>
      )}
      {(data ?? []).map((row) => (
        <Card key={row.id} withBorder>
          <Group justify="space-between" wrap="nowrap">
            <Stack gap={2}>
              <Text fw={500}>{describe(row)}</Text>
              <Text size="sm" c="dimmed">
                {row.lastError ?? 'Unknown reason'}
              </Text>
            </Stack>
            <Button
              color="red"
              variant="light"
              onClick={() => setConfirming(row)}
            >
              Discard
            </Button>
          </Group>
        </Card>
      ))}
      {blocked && (pendingRows ?? []).length > 0 && (
        <Stack gap="xs">
          <Text fw={500}>Not yet synced</Text>
          {(pendingRows ?? []).map((row) => (
            <Card key={row.id} withBorder>
              <Text>{describe(row)}</Text>
              <Text size="sm" c="dimmed">
                Not yet synced
              </Text>
            </Card>
          ))}
        </Stack>
      )}
      <Modal
        opened={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Discard this record?"
      >
        <Stack>
          <Text>It will be removed from this device and never synced.</Text>
          <Group justify="flex-end">
            <Button variant="default" onClick={() => setConfirming(null)}>
              Cancel
            </Button>
            <Button color="red" onClick={() => void discard()}>
              Confirm discard
            </Button>
          </Group>
        </Stack>
      </Modal>
    </Stack>
  );
}
