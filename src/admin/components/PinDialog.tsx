import { Button, Group, Modal, PinInput, Stack, Text } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { deskCall } from '#/desk/desk-call';
import { resetPin } from '#/server/admin/users.fn';
import type { DeskError } from '#/server/desk/warehouses.server';

export const PIN_RESET_OK = 'PIN reset; the account is unlocked';

export function PinDialog({
  user,
  onClose,
}: {
  user: { id: string; name: string } | null;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<Pick<
    DeskError,
    'code' | 'message'
  > | null>(null);

  function close() {
    if (inFlight.current) return;
    // The PIN never outlives the dialog.
    setPin('');
    setDone(false);
    setError(null);
    onClose();
  }

  async function submit() {
    if (!user || pin.length !== 4 || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await deskCall(resetPin, { userId: user.id, pin });
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      if (res.ok) {
        setPin('');
        setDone(true);
      } else setError(res);
    } catch (err) {
      setError({
        code: 'INVALID',
        message: err instanceof Error ? err.message : 'Request failed',
      });
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  return (
    <Modal
      opened={user !== null}
      onClose={close}
      title={user ? `Reset PIN for ${user.name}` : 'Reset PIN'}
    >
      <Stack>
        {done ? (
          <Text role="status">{PIN_RESET_OK}</Text>
        ) : (
          <PinInput
            length={4}
            type="number"
            mask
            oneTimeCode={false}
            ariaLabel="PIN digit"
            value={pin}
            disabled={pending}
            onChange={setPin}
          />
        )}
        {error && <DeskErrorAlert error={error} />}
        <Group justify="flex-end">
          <Button variant="default" disabled={pending} onClick={close}>
            {done ? 'Close' : 'Cancel'}
          </Button>
          {!done && (
            <Button
              disabled={pending || pin.length !== 4}
              loading={pending}
              onClick={() => void submit()}
            >
              Reset PIN
            </Button>
          )}
        </Group>
      </Stack>
    </Modal>
  );
}
