import { Text } from '@mantine/core';

export const REFRESH_FAILED = 'Refresh failed — showing the last loaded data.';

/** Shown when a background poll failed but earlier data is still on screen. */
export function RefreshNote() {
  return (
    <Text size="xs" c="orange" role="status">
      {REFRESH_FAILED}
    </Text>
  );
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed';
}
