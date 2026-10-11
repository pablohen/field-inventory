import { useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import type { MovementInput } from '#/domain/schemas';
import { buildMovementInput, useRecordMovement } from './record';
import { getCachedSession, getDeviceId } from './session-store';

/**
 * Records one movement per accepted confirm. `submit` is guarded by a
 * synchronous ref: a second call before the form resets (after success or
 * error) is ignored, so double Enter / double tap can never record twice.
 * The input is built inside `submit`, once per accepted confirm.
 */
export function useRecorder(wh: string) {
  const mutation = useRecordMovement(wh);
  const navigate = useNavigate();
  const submitting = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  const submit = (
    kind: MovementInput['type'],
    fields: Record<string, unknown>,
    onRecorded: () => void,
  ) => {
    if (submitting.current) return;
    const session = getCachedSession();
    if (!session) {
      void navigate({ to: '/h/login' });
      return;
    }
    submitting.current = true;
    setError(null);
    setRecorded(false);
    let input: MovementInput;
    try {
      input = buildMovementInput(kind, fields, {
        warehouseId: wh,
        userId: session.userId,
        deviceId: getDeviceId() ?? session.deviceId,
        now: new Date(),
        newId: () => crypto.randomUUID(),
      });
    } catch (err) {
      submitting.current = false;
      setError(err instanceof Error ? err.message : 'Invalid movement');
      return;
    }
    mutation.mutate(input, {
      onSuccess: () => {
        submitting.current = false;
        setRecorded(true);
        onRecorded();
      },
      onError: (err) => {
        submitting.current = false;
        setError(
          err.name === 'StorageFullError'
            ? 'Device storage is full. Nothing was recorded.'
            : `Could not record: ${err.message}`,
        );
      },
    });
  };

  return {
    submit,
    isPending: mutation.isPending,
    error,
    setError,
    recorded,
    clearRecorded: () => setRecorded(false),
  };
}
