export interface TokenMinter {
  mint(dbName: string): Promise<{ token: string; expiresAt: string }>;
}

const SEVEN_DAYS_MS = 7 * 24 * 3600_000;

/** Mints read-only, 7-day database tokens via the Turso Platform API. */
export function tursoTokenMinter(
  env: { org: string; platformToken: string },
  fetchFn: typeof fetch = fetch,
): TokenMinter {
  return {
    async mint(dbName) {
      const url = `https://api.turso.tech/v1/organizations/${encodeURIComponent(env.org)}/databases/${encodeURIComponent(dbName)}/auth/tokens?expiration=7d&authorization=read-only`;
      const res = await fetchFn(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${env.platformToken}` },
      });
      if (!res.ok) {
        throw new Error(
          `Turso token mint failed for ${dbName}: HTTP ${res.status}`,
        );
      }
      const body = (await res.json()) as { jwt?: string };
      if (!body.jwt) {
        throw new Error(`Turso token mint returned no jwt for ${dbName}`);
      }
      return {
        token: body.jwt,
        expiresAt: new Date(Date.now() + SEVEN_DAYS_MS).toISOString(),
      };
    },
  };
}
