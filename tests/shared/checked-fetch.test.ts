import { createClientRpc } from '@tanstack/react-start/client-rpc';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { isDeskAuthError } from '#/desk/auth-error';
import { deskCall } from '#/desk/desk-call';
import { authCheckedFetch, deskFetch, HttpError } from '#/shared/checked-fetch';

const raw = (status: number, body = 'x') =>
  new Response(body, { status, headers: { 'x-tss-raw': 'true' } });

afterEach(() => vi.unstubAllGlobals());

describe('deskFetch', () => {
  it.each([401, 403])(
    'throws HttpError(%i) for a raw response',
    async (status) => {
      vi.stubGlobal('fetch', async () => raw(status, 'nope'));
      const err = await deskFetch('/x').catch((e: unknown) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect((err as HttpError).status).toBe(status);
      expect(isDeskAuthError(err)).toBe(true);
    },
  );

  it('throws for a plain 401 without the raw header', async () => {
    vi.stubGlobal(
      'fetch',
      async () => new Response('Unauthorized', { status: 401 }),
    );
    await expect(deskFetch('/x')).rejects.toMatchObject({ status: 401 });
  });

  it('passes 200 through untouched', async () => {
    const ok = new Response('fine', { status: 200 });
    vi.stubGlobal('fetch', async () => ok);
    expect(await deskFetch('/x')).toBe(ok);
  });

  it('passes other statuses through (typed errors and 500s resolve normally)', async () => {
    for (const status of [400, 404, 409, 500]) {
      const res = new Response('{}', { status });
      vi.stubGlobal('fetch', async () => res);
      expect(await deskFetch('/x')).toBe(res);
    }
  });
});

describe('isDeskAuthError', () => {
  it('recognizes HttpError 401/403 only', () => {
    expect(isDeskAuthError(new HttpError(401, 'x'))).toBe(true);
    expect(isDeskAuthError(new HttpError(403, 'x'))).toBe(true);
    expect(isDeskAuthError(new HttpError(500, 'x'))).toBe(false);
  });
});

describe('real server-fn client fetcher', () => {
  beforeAll(() => {
    process.env.TSS_SERVER_FN_BASE = '/_serverFn/';
  });
  // The client RPC reads Start options from a process-global async store.
  const store = (globalThis as Record<symbol, unknown>)[
    Symbol.for('tanstack-start:start-storage-context')
  ] as { run<T>(ctx: unknown, fn: () => T): T };
  type Rpc = (opts?: {
    data?: unknown;
    fetch?: typeof fetch;
  }) => Promise<unknown>;
  const rpc = (): Rpc => {
    const fn = createClientRpc('desk_fn') as unknown as Rpc;
    return (opts) => store.run({ startOptions: {} }, () => fn(opts));
  };
  const authFake = vi.fn(async () => raw(401, 'Unauthorized'));

  it('without the wrapper a 401 resolves as a plain Response (the bug)', async () => {
    const out = await rpc()({ fetch: authFake as unknown as typeof fetch });
    expect(out).toBeInstanceOf(Response);
  });

  it('deskCall turns the same 401 into a rejected HttpError', async () => {
    vi.stubGlobal('fetch', authFake);
    const err = await deskCall(rpc() as never).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect(isDeskAuthError(err)).toBe(true);
  });

  it('authCheckedFetch composes with a custom fetch', async () => {
    await expect(
      rpc()({ fetch: authCheckedFetch(authFake as unknown as typeof fetch) }),
    ).rejects.toMatchObject({ status: 401 });
  });
});
