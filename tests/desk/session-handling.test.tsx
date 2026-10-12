// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { QueryClient } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isDeskAuthError, watchDeskAuth } from '#/desk/auth-error';
import { SignOutButton } from '#/desk/components/SignOutButton';

const deskLogout = vi.hoisted(() => vi.fn());
vi.mock('#/server/desk/desk-auth.fn', () => ({ deskLogout }));

beforeAll(() => {
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SignOutButton', () => {
  const mount = (navigate: (u: string) => void) =>
    render(
      <MantineProvider>
        <SignOutButton navigate={navigate} />
      </MantineProvider>,
    );

  it('stays put and shows an error when deskLogout fails', async () => {
    deskLogout.mockRejectedValue(new TypeError('Failed to fetch'));
    const navigate = vi.fn();
    mount(navigate);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    expect(await screen.findByText('Sign-out needs a connection')).toBeTruthy();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('navigates to the login page after success', async () => {
    deskLogout.mockResolvedValue({ ok: true });
    const navigate = vi.fn();
    mount(navigate);
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await vi.waitFor(() =>
      expect(navigate).toHaveBeenCalledWith('/desk/login'),
    );
  });
});

describe('isDeskAuthError', () => {
  it('recognizes 401/403 shapes', () => {
    expect(isDeskAuthError(new Error('Unauthorized'))).toBe(true);
    expect(isDeskAuthError(new Error('Forbidden'))).toBe(true);
    expect(isDeskAuthError(new Response('Unauthorized', { status: 401 }))).toBe(
      true,
    );
    expect(isDeskAuthError({ status: 403 })).toBe(true);
  });
  it('rejects other errors', () => {
    expect(isDeskAuthError(new Error('boom'))).toBe(false);
    expect(isDeskAuthError(new TypeError('Failed to fetch'))).toBe(false);
    expect(isDeskAuthError({ status: 500 })).toBe(false);
    expect(isDeskAuthError(null)).toBe(false);
    expect(isDeskAuthError('Unauthorized')).toBe(false);
  });
});

describe('watchDeskAuth', () => {
  const client = () =>
    new QueryClient({ defaultOptions: { queries: { retry: false } } });

  it('fires when a desk query rejects with an auth error', async () => {
    const qc = client();
    const onExpired = vi.fn();
    const stop = watchDeskAuth(qc, onExpired);
    await qc
      .fetchQuery({
        queryKey: ['desk', 'stock', 'wh-1'],
        queryFn: () => Promise.reject(new Error('Unauthorized')),
      })
      .catch(() => {});
    expect(onExpired).toHaveBeenCalledTimes(1);
    stop();
  });

  it('ignores other errors and non-desk queries, and stops after unsubscribe', async () => {
    const qc = client();
    const onExpired = vi.fn();
    const stop = watchDeskAuth(qc, onExpired);
    await qc
      .fetchQuery({
        queryKey: ['desk', 'a'],
        queryFn: () => Promise.reject(new Error('boom')),
      })
      .catch(() => {});
    await qc
      .fetchQuery({
        queryKey: ['other'],
        queryFn: () => Promise.reject(new Error('Unauthorized')),
      })
      .catch(() => {});
    stop();
    await qc
      .fetchQuery({
        queryKey: ['desk', 'b'],
        queryFn: () => Promise.reject(new Error('Unauthorized')),
      })
      .catch(() => {});
    expect(onExpired).not.toHaveBeenCalled();
  });
});
