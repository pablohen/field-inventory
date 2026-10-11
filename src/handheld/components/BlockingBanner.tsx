import { Alert, Button, List, Stack } from '@mantine/core';
import type { MissingCapability } from '../capabilities';

export function BlockingBanner(
  props:
    | { kind: 'capabilities'; missing: MissingCapability[] }
    | { kind: 'boot'; message: string }
    | { kind: 'storage'; onDismiss?: () => void },
) {
  if (props.kind === 'capabilities') {
    return (
      <Alert color="red" title="This browser cannot run the handheld app">
        <Stack gap="xs">
          <span>These features are missing:</span>
          <List size="sm">
            {props.missing.map((m) => (
              <List.Item key={m}>{m}</List.Item>
            ))}
          </List>
        </Stack>
      </Alert>
    );
  }
  if (props.kind === 'boot') {
    return (
      <Alert color="red" title="The handheld app could not start">
        {props.message}
      </Alert>
    );
  }
  return (
    <Alert color="red" title="Device storage is full">
      <Stack gap="xs">
        <span>
          Recent work could not be saved. Free up space or sync, then try again.
        </span>
        {props.onDismiss && (
          <Button size="xs" variant="light" onClick={props.onDismiss}>
            Dismiss
          </Button>
        )}
      </Stack>
    </Alert>
  );
}
