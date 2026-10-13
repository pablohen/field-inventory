import { Alert, Button } from '@mantine/core';
import { TOUCH } from '../touch';

export function ConfirmButton({
  onConfirm,
  isPending,
  label = 'Confirm',
}: {
  onConfirm(): void;
  isPending: boolean;
  label?: string;
}) {
  return (
    <Button
      size="md"
      fullWidth
      // Inline (not `mih`) so jsdom can read the 48px minimum.
      style={TOUCH}
      disabled={isPending}
      onClick={onConfirm}
    >
      {label}
    </Button>
  );
}

/** Shows the outcome of the last confirm: an error (form state is kept) or "Recorded". */
export function RecordStatus({
  error,
  recorded,
}: {
  error: string | null;
  recorded: boolean;
}) {
  if (error) return <Alert color="red">{error}</Alert>;
  if (recorded) return <Alert color="green">Recorded</Alert>;
  return null;
}
