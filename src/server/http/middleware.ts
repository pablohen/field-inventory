import { createMiddleware } from '@tanstack/react-start';
import { withSecurityHeaders } from './security-headers';

/** Global request middleware: COOP/COEP on every response. */
export const securityHeadersMiddleware = createMiddleware().server(
  async ({ next }) => {
    const result = await next();
    return { ...result, response: withSecurityHeaders(result.response) };
  },
);
