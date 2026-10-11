import { Alert, Button, PinInput, Stack, Text, TextInput } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { checkedFetch } from '#/handheld/push';
import {
  getDeviceId,
  setCachedSession,
  setDeviceId,
} from '#/handheld/session-store';
import { login } from '#/server/auth/auth.fn';

export const Route = createFileRoute('/h/login')({ component: LoginPage });

const REASONS = {
  BAD_CREDENTIALS: 'Wrong username or PIN',
  DEVICE_REVOKED: "This device isn't enrolled",
  DEVICE_UNKNOWN: "This device isn't enrolled",
} as const;

const OFFLINE = 'Sign-in needs a connection';

function LoginPage() {
  // Read once on the client (the route is ssr: false).
  const [storedDevice] = useState(getDeviceId);
  const [deviceId, setDevice] = useState('');
  const [username, setUsername] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const effectiveDevice = storedDevice ?? deviceId.trim();
  const canSubmit =
    effectiveDevice !== '' && username.trim() !== '' && pin.length === 4;

  const submit = async () => {
    if (!navigator.onLine) {
      setError(OFFLINE);
      return;
    }
    setBusy(true);
    setError('');
    try {
      // The checked fetch makes HTTP errors throw (a thrown Response loses its status otherwise).
      const call = login as unknown as (opts: {
        data: { username: string; pin: string; deviceId: string };
        fetch: typeof fetch;
      }) => Promise<
        | {
            ok: true;
            user: {
              id: string;
              name: string;
              role: 'worker' | 'supervisor' | 'admin';
            };
            deviceId: string;
            expiresAt: string;
          }
        | { ok: false; reason: keyof typeof REASONS }
      >;
      const res = await call({
        data: {
          username: username.trim(),
          pin,
          deviceId: effectiveDevice,
        },
        fetch: checkedFetch(),
      });
      if (!res.ok) {
        setError(REASONS[res.reason] ?? 'Sign-in failed');
        return;
      }
      if (!storedDevice) setDeviceId(res.deviceId);
      setCachedSession({
        userId: res.user.id,
        name: res.user.name,
        role: res.user.role,
        deviceId: res.deviceId,
        expiresAt: res.expiresAt,
      });
      // Full reload so the provider and leader boot with the new session.
      window.location.assign('/h');
    } catch (err) {
      setError(err instanceof TypeError ? OFFLINE : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !busy) void submit();
      }}
    >
      <Stack>
        {!storedDevice && (
          <TextInput
            label="Device id"
            value={deviceId}
            onChange={(e) => setDevice(e.currentTarget.value)}
          />
        )}
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
  );
}
