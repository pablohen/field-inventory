/** Cross-origin isolation, required for SharedArrayBuffer / OPFS in the PWA. */
export const SECURITY_HEADERS = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
} as const;

/** Returns `response` carrying the security headers (cloning if immutable). */
export function withSecurityHeaders(response: Response): Response {
  try {
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      response.headers.set(k, v);
    }
    return response;
  } catch {
    const copy = new Response(response.body, response);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      copy.headers.set(k, v);
    }
    return copy;
  }
}
