import { Alert, type AlertProps, Button, List, Stack } from '@mantine/core';
import type { MissingCapability } from '../capabilities';
import { TOUCH } from '../touch';

/** Rail fill with signal text (pair covered by the signal/rail contrast test). */
const RAIL_ALERT: AlertProps = {
  styles: {
    root: {
      background: 'var(--fi-rail)',
      color: 'var(--fi-signal)',
      border: '2px solid var(--fi-signal)',
    },
    title: { color: 'var(--fi-signal)' },
    message: { color: 'var(--fi-signal)' },
  },
};

export function BlockingBanner(
  props:
    | { kind: 'capabilities'; missing: MissingCapability[] }
    | { kind: 'boot'; message: string }
    | { kind: 'storage'; onDismiss?: () => void },
) {
  if (props.kind === 'capabilities') {
    return (
      <Alert {...RAIL_ALERT} title="This browser cannot run the handheld app">
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
      <Alert {...RAIL_ALERT} title="The handheld app could not start">
        {props.message}
      </Alert>
    );
  }
  return (
    <Alert {...RAIL_ALERT} title="Device storage is full">
      <Stack gap="xs">
        <span>
          Recent work could not be saved. Free up space or sync, then try again.
        </span>
        {props.onDismiss && (
          <Button
            size="xs"
            variant="outline"
            style={{
              ...TOUCH,
              color: 'var(--fi-signal)',
              borderColor: 'var(--fi-signal)',
            }}
            onClick={props.onDismiss}
          >
            Dismiss
          </Button>
        )}
      </Stack>
    </Alert>
  );
}
