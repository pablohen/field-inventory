import { describe, expect, it, vi } from 'vitest';
import { createPush, HttpError } from '#/handheld/push';
import { pushErrorKind } from '#/handheld/sync-loop';

const batch = {
  deviceId: 'd1',
  schemaVersion: 1,
  sentAt: '2026-01-01T00:00:00.000Z',
  movements: [],
};

/** A fake server fn that, like the real one, routes through the given fetch. */
const fakeFn =
  (url = '/_serverFn/x') =>
  async (opts: { data: unknown; fetch?: typeof fetch }) => {
    const res = await (opts.fetch as typeof fetch)(url, { method: 'POST' });
    return res.json();
  };

describe('createPush', () => {
  it.each([401, 403])(
    'maps HTTP %i to an auth error with status',
    async (s) => {
      const push = createPush(
        fakeFn(),
        vi.fn(async () => new Response('Unauthorized', { status: s })),
      );
      const err = await push(batch).catch((e) => e);
      expect(err).toBeInstanceOf(HttpError);
      expect(err.status).toBe(s);
      expect(pushErrorKind(err)).toBe('auth');
    },
  );

  it.each([400, 503])('maps HTTP %i to a retryable error', async (s) => {
    const push = createPush(
      fakeFn(),
      vi.fn(
        async () =>
          new Response('{"error":"x"}', {
            status: s,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    const err = await push(batch).catch((e) => e);
    expect(err.status).toBe(s);
    expect(pushErrorKind(err)).toBe('offline');
  });

  it('leaves network failures as the original TypeError', async () => {
    const boom = new TypeError('Failed to fetch');
    const push = createPush(
      fakeFn(),
      vi.fn(async () => {
        throw boom;
      }),
    );
    const err = await push(batch).catch((e) => e);
    expect(err).toBe(boom);
    expect(pushErrorKind(err)).toBe('offline');
  });

  it('returns the parsed sync response on success', async () => {
    const push = createPush(
      fakeFn(),
      vi.fn(
        async () =>
          new Response(JSON.stringify({ status: 'ok', results: [] }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }),
      ),
    );
    expect(await push(batch)).toEqual({ status: 'ok', results: [] });
  });

  it('rejects a resolved value that is not a sync response', async () => {
    const push = createPush(async () => ({ error: 'nope' }));
    await expect(push(batch)).rejects.toThrow('Malformed sync response');
  });
});
