const PLACEHOLDER_SECRET = 'change-me-to-a-long-random-string';

/** Returns a usable session secret or throws. Shared by startup and signing. */
export function requireSessionSecret(secret: string | undefined): string {
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }
  if (secret === PLACEHOLDER_SECRET) {
    throw new Error(
      'SESSION_SECRET must be at least 32 characters and not the example placeholder',
    );
  }
  return secret;
}

/** Throws unless the server has what it needs to run safely. */
export function assertServerEnv(
  env: Record<string, string | undefined> = process.env,
): void {
  requireSessionSecret(env.SESSION_SECRET);
}
