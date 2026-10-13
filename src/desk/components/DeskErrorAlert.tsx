import { Alert, Button, Group } from '@mantine/core';
import type { DeskError } from '#/server/desk/warehouses.server';

export const CONFLICT_MESSAGE =
  'Resolved by someone else. Reload to see what changed.';

/** Renders any typed DeskError result: orange for CONFLICT, red otherwise. */
export function DeskErrorAlert({
  error,
  onReload,
}: {
  error: Pick<DeskError, 'code' | 'message'>;
  onReload?: () => void;
}) {
  if (error.code === 'CONFLICT') {
    return (
      <Alert
        color="orange"
        role="alert"
        style={{ border: '2px solid var(--fi-danger)' }}
      >
        <Group justify="space-between" wrap="nowrap">
          <span>{CONFLICT_MESSAGE}</span>
          {onReload && (
            <Button size="xs" variant="light" color="orange" onClick={onReload}>
              Reload
            </Button>
          )}
        </Group>
      </Alert>
    );
  }
  return (
    <Alert
      color="red"
      role="alert"
      style={{ border: '2px solid var(--fi-danger)' }}
    >
      {error.message}
    </Alert>
  );
}
