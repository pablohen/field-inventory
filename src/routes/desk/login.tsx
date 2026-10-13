import { Alert, Button, PinInput, Stack, Text, TextInput } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { deskLogin } from '#/server/desk/desk-auth.fn';
import { checkedFetch } from '#/shared/checked-fetch';
import { AuthSplit } from '#/ui/AuthSplit';

export const Route = createFileRoute('/desk/login')({ component: DeskLogin });

export const DESK_LOGIN_REASONS = {
  BAD_CREDENTIALS: 'Wrong username or PIN',
  NOT_ALLOWED: "This account can't use the desk",
  LOCKED: 'Too many attempts. Try again in 15 minutes.',
} as const;

const OFFLINE = 'Sign-in needs a connection';

type LoginResult =
  | { ok: true }
  | { ok: false; reason: keyof typeof DESK_LOGIN_REASONS };

export function DeskLogin() {
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const canSubmit = username.trim() !== '' && pin.length === 4;

  const submit = async () => {
    setBusy(true);
    setError('');
    try {
      const call = deskLogin as unknown as (opts: {
        data: { username: string; pin: string };
        fetch: typeof fetch;
      }) => Promise<LoginResult>;
      const res = await call({
        data: { username: username.trim(), pin },
        fetch: checkedFetch(),
      });
      if (!res.ok) {
        setError(DESK_LOGIN_REASONS[res.reason] ?? 'Sign-in failed');
        return;
      }
      // Full reload so the cookie and route guards apply cleanly.
      window.location.assign('/');
    } catch (err) {
      setError(err instanceof TypeError ? OFFLINE : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthSplit title="Supervisor sign-in">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !busy) void submit();
        }}
      >
        <Stack>
          <TextInput
            label="Username"
            autoComplete="username"
            autoCapitalize="off"
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
          />
          <div>
            <Text size="sm" fw={500} mb={4}>
              PIN
            </Text>
            <PinInput
              length={4}
              type="number"
              mask
              inputMode="numeric"
              value={pin}
              onChange={setPin}
              aria-label="PIN"
            />
          </div>
          {error && <Alert color="red">{error}</Alert>}
          <Button type="submit" loading={busy} disabled={!canSubmit}>
            Sign in
          </Button>
        </Stack>
      </form>
    </AuthSplit>
  );
}
