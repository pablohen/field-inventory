/**
 * Hand-maintained; tests/server/migrate.test.ts checks it against the files on
 * disk. Lives outside `server/db/migrate.ts` (Node fs imports) so the client
 * bundle can import it.
 */
export const SCHEMA_VERSIONS = {
  global: 4,
  catalog: 1,
  warehouse: 1,
} as const;
