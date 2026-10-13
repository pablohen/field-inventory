import { Alert, Button, Stack, Text, TextInput, Title } from '@mantine/core';
import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { HandheldPinInput } from '#/handheld/components/HandheldPinInput';
import {
  getDeviceId,
  setCachedSession,
  setDeviceId,
} from '#/handheld/session-store';
import { TOUCH } from '#/handheld/touch';
import { login } from '#/server/auth/auth.fn';
import { checkedFetch } from '#/shared/checked-fetch';

export const Route = createFileRoute('/h/login')({ component: LoginPage });

const REASONS = {
  BAD_CREDENTIALS: 'Wrong username or PIN',
  DEVICE_REVOKED: "This device isn't enrolled",
  DEVICE_UNKNOWN: "This device isn't enrolled",
  LOCKED: 'Too many attempts. Try again in 15 minutes.',
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
    <div style={{ minHeight: '100vh', background: 'var(--fi-surface)' }}>
      <div className="fi-stripe" style={{ height: 16 }} aria-hidden="true" />
      <form
        style={{ padding: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit && !busy) void submit();
        }}
      >
        <Stack>
          <Title order={2}>▲ Handheld</Title>
          {!storedDevice && (
            <TextInput
              styles={{ input: TOUCH }}
              label="Device id"
              value={deviceId}
              onChange={(e) => setDevice(e.currentTarget.value)}
            />
          )}
          <TextInput
            styles={{ input: TOUCH }}
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
            <HandheldPinInput value={pin} onChange={setPin} />
          </div>
          {error && <Alert color="red">{error}</Alert>}
          <Button
            style={TOUCH}
            type="submit"
            fullWidth
            loading={busy}
            disabled={!canSubmit}
          >
            Sign in
          </Button>
        </Stack>
      </form>
    </div>
  );
}
