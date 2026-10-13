import { afterEach, describe, expect, it, vi } from 'vitest';
import { onSessionExpired } from '#/desk/auth-error';
import { readableError, runMutation } from '#/desk/run-mutation';
import { HttpError } from '#/shared/checked-fetch';

describe('runMutation', () => {
  let stop = () => {};
  afterEach(() => stop());

  it('resolves to the result and reports nothing on success', async () => {
    const onError = vi.fn();
    const res = await runMutation(async () => ({ ok: true }), onError);
    expect(res).toEqual({ ok: true });
    expect(onError).not.toHaveBeenCalled();
  });

  it('leaves a typed DeskError result to the caller', async () => {
    const onError = vi.fn();
    const err = { ok: false, code: 'CONFLICT', message: 'Stale' };
    expect(await runMutation(async () => err, onError)).toBe(err);
    expect(onError).not.toHaveBeenCalled();
  });

  it.each([401, 403])(
    'sends HttpError(%i) to the session-expiry handler',
    async (status) => {
      const expired = vi.fn();
      stop = onSessionExpired(expired);
      const onError = vi.fn();
      const res = await runMutation(
        () => Promise.reject(new HttpError(status, '{"error":"Unauthorized"}')),
        onError,
      );
      expect(res).toBeUndefined();
      expect(expired).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();
    },
  );

  it('reports other throws as a readable INVALID', async () => {
    const expired = vi.fn();
    stop = onSessionExpired(expired);
    const onError = vi.fn();
    await runMutation(() => Promise.reject(new Error('boom')), onError);
    expect(onError).toHaveBeenCalledWith({ code: 'INVALID', message: 'boom' });
    expect(expired).not.toHaveBeenCalled();
  });
});

describe('readableError', () => {
  it('unwraps a JSON error body', () => {
    expect(readableError(new Error('{"error":"Database is locked"}'))).toBe(
      'Database is locked',
    );
    expect(readableError(new Error('{"message":"Bad input"}'))).toBe(
      'Bad input',
    );
  });

  it('never returns JSON it cannot unwrap', () => {
    expect(readableError(new Error('{"code":42}'))).toBe('Request failed');
    expect(readableError(new Error('[1,2]'))).toBe('Request failed');
    expect(readableError(new Error('{"error":'))).toBe('Request failed');
  });

  it('keeps a plain message and covers non-errors', () => {
    expect(readableError(new Error('Stock is negative'))).toBe(
      'Stock is negative',
    );
    expect(readableError(new Error('  '))).toBe('Request failed');
    expect(readableError('nope')).toBe('Request failed');
    expect(readableError(new Response('x', { status: 500 }))).toBe(
      'Request failed (HTTP 500)',
    );
  });

  it('names a dropped connection', () => {
    expect(readableError(new TypeError('Failed to fetch'))).toBe(
      'Saving needs a connection',
    );
    expect(readableError(new TypeError('x is undefined'))).toBe(
      'x is undefined',
    );
  });
});
