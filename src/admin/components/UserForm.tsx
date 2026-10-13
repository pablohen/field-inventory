import {
  Button,
  PinInput,
  Select,
  Stack,
  Text,
  TextInput,
} from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { createUserInputSchema, roleSchema } from '#/admin/user-input';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { deskCall } from '#/desk/desk-call';
import { createUser } from '#/server/admin/users.fn';
import type { DeskError } from '#/server/desk/warehouses.server';

export const ROLE_OPTIONS = roleSchema.options.map((r) => ({
  value: r,
  label: r.charAt(0).toUpperCase() + r.slice(1),
}));

export function UserForm({ onCreated }: { onCreated: () => void }) {
  const qc = useQueryClient();
  const [username, setUsername] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<string>('worker');
  const [pin, setPin] = useState('');
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<Pick<
    DeskError,
    'code' | 'message'
  > | null>(null);

  const parsed = createUserInputSchema.safeParse({ username, name, role, pin });
  const usernameValid =
    createUserInputSchema.shape.username.safeParse(username).success;

  async function submit() {
    if (!parsed.success || inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await deskCall(createUser, parsed.data);
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      if (res.ok) {
        setPin('');
        onCreated();
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
    <Stack gap="sm">
      <TextInput
        label="Username"
        description="Lowercase letters, digits, dots, dashes and underscores; starts with a letter."
        value={username}
        disabled={pending}
        error={
          username !== '' && !usernameValid ? 'Invalid username' : undefined
        }
        onChange={(e) => setUsername(e.currentTarget.value)}
      />
      <TextInput
        label="Name"
        value={name}
        disabled={pending}
        onChange={(e) => setName(e.currentTarget.value)}
      />
      <Select
        label="Role"
        data={ROLE_OPTIONS}
        value={role}
        allowDeselect={false}
        disabled={pending}
        onChange={(v) => v && setRole(v)}
      />
      <Stack gap={4}>
        <Text size="sm" fw={500}>
          PIN (4 digits)
        </Text>
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
      </Stack>
      {error && <DeskErrorAlert error={error} />}
      <Button
        onClick={() => void submit()}
        disabled={pending || !parsed.success}
        loading={pending}
      >
        Create user
      </Button>
    </Stack>
  );
}
