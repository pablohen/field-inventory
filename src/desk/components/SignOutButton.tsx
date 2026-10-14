import { Button, Text } from '@mantine/core';
import { SignOutIcon } from '@phosphor-icons/react';
import { useState } from 'react';
import { deskCall } from '#/desk/desk-call';
import { deskLogout } from '#/server/desk/desk-auth.fn';

/** Signs out via the server (the cookie is httpOnly); navigates only on success. */
export function SignOutButton({
  navigate = (url: string) => window.location.assign(url),
}: {
  navigate?: (url: string) => void;
}) {
  const [error, setError] = useState('');
  const signOut = async () => {
    setError('');
    try {
      await deskCall(deskLogout);
    } catch {
      setError('Sign-out needs a connection');
      return;
    }
    navigate('/desk/login');
  };
  return (
    <>
      {error && (
        <Text size="sm" c="red" role="alert">
          {error}
        </Text>
      )}
      <Button
        size="compact-sm"
        variant="subtle"
        onClick={signOut}
        leftSection={<SignOutIcon size={16} weight="bold" aria-hidden="true" />}
      >
        Sign out
      </Button>
    </>
  );
}
