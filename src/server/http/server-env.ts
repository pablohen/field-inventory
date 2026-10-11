/** Throws unless the server has what it needs to run safely. */
export function assertServerEnv(
  env: Record<string, string | undefined> = process.env,
): void {
  const secret = env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error('SESSION_SECRET must be at least 32 characters');
  }
}
