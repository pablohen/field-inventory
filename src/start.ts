import { createCsrfMiddleware, createStart } from '@tanstack/react-start';
import { securityHeadersMiddleware } from '#/server/http/middleware';
import { assertServerEnv } from '#/server/http/server-env';

// The server refuses to start without a usable session secret.
if (process.env.NODE_ENV === 'production') assertServerEnv();

// Registering a start instance replaces Start's default CSRF protection, so
// it is re-added here exactly as the default configures it.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === 'serverFn',
});

export const startInstance = createStart(() => ({
  requestMiddleware: [securityHeadersMiddleware, csrfMiddleware],
}));
