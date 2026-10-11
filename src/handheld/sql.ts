/**
 * Minimal async SQL surface shared by the browser (OPFS/wasm) and Node tests.
 * Browser-safe: must not import `@libsql/client` (see tests/support/handheld-sql.ts).
 */
export interface Sql {
  all<T = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>;
  run(sql: string, params?: unknown[]): Promise<void>;
}
