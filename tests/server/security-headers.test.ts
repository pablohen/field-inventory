import { describe, expect, it } from 'vitest';
import { securityHeadersMiddleware } from '#/server/http/middleware';
import {
  SECURITY_HEADERS,
  withSecurityHeaders,
} from '#/server/http/security-headers';
import { assertServerEnv } from '#/server/http/server-env';
import config from '../../vite.config';

describe('security headers', () => {
  it('has the exact COOP/COEP values', () => {
    expect(SECURITY_HEADERS).toEqual({
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    });
  });

  it('applies them to a normal response', () => {
    const res = withSecurityHeaders(new Response('x'));
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe(
      'require-corp',
    );
  });

  it('applies them to an immutable response (redirect)', () => {
    const res = withSecurityHeaders(Response.redirect('http://x/h', 302));
    expect(res.status).toBe(302);
    expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
    expect(res.headers.get('Cross-Origin-Embedder-Policy')).toBe(
      'require-corp',
    );
  });

  it('is configured for vite dev and preview', () => {
    const c = config as {
      server?: { headers?: unknown };
      preview?: { headers?: unknown };
    };
    expect(c.server?.headers).toEqual(SECURITY_HEADERS);
    expect(c.preview?.headers).toEqual(SECURITY_HEADERS);
  });
});

describe('assertServerEnv', () => {
  it('throws when SESSION_SECRET is missing or short', () => {
    expect(() => assertServerEnv({})).toThrow(
      'SESSION_SECRET must be at least 32 characters',
    );
    expect(() => assertServerEnv({ SESSION_SECRET: 'a'.repeat(31) })).toThrow(
      'SESSION_SECRET must be at least 32 characters',
    );
  });
  it('accepts a 32+ char secret', () => {
    expect(() =>
      assertServerEnv({ SESSION_SECRET: 'a'.repeat(32) }),
    ).not.toThrow();
  });
});

describe('securityHeadersMiddleware', () => {
  it('adds the headers to the downstream response', async () => {
    const server = (
      securityHeadersMiddleware as unknown as {
        options: { server: (ctx: unknown) => Promise<{ response: Response }> };
      }
    ).options.server;
    const out = await server({
      next: async () => ({ response: new Response('ok', { status: 201 }) }),
    });
    expect(out.response.status).toBe(201);
    expect(out.response.headers.get('Cross-Origin-Opener-Policy')).toBe(
      'same-origin',
    );
    expect(out.response.headers.get('Cross-Origin-Embedder-Policy')).toBe(
      'require-corp',
    );
  });
});
