import { connect } from '@tursodatabase/sync-wasm/vite';
// Type-only: keeps server code out of the client bundle.
import type { ReplicaConfig } from '#/server/replicas/replica-config.fn';
import { ensureOutboxSchema } from './outbox';
import type { Sql } from './sql';

export interface Replica extends Sql {
  name: string;
  /** Resolves true when new changes were pulled. Rejects when offline (treat as stale). */
  pull(): Promise<boolean>;
  checkpoint(): Promise<void>;
  close(): Promise<void>;
}

type Db = Awaited<ReturnType<typeof connect>>;

/** Adapts a sync-wasm database to the `Sql` surface (bind params are spread). */
function toSql(db: Db): Sql {
  return {
    async all<T = Record<string, unknown>>(
      sql: string,
      params: unknown[] = [],
    ) {
      const stmt = await db.prepare(sql);
      return (await stmt.all(...params)) as T[];
    },
    async run(sql: string, params: unknown[] = []) {
      const stmt = await db.prepare(sql);
      await stmt.run(...params);
    },
  };
}

export const OUTBOX_PATH = 'outbox.db';

/** Opens a read-only synced replica. Writes are blocked locally by query_only. */
export async function openReplica(
  cfg: ReplicaConfig['replicas'][number],
  getToken: () => Promise<string>,
): Promise<Replica> {
  const db = await connect({
    path: `${cfg.dbName}.db`,
    url: cfg.url,
    authToken: getToken,
    clientName: 'fi-handheld',
  });
  // Per-connection; without it a stray local write diverges the replica for good.
  try {
    await db.exec('PRAGMA query_only = 1');
  } catch (err) {
    await db.close().catch(() => {});
    throw err;
  }
  return {
    name: cfg.name,
    ...toSql(db),
    pull: () => db.pull(),
    checkpoint: () => db.checkpoint(),
    close: () => db.close(),
  };
}

/** Opens the local-only read-write outbox database. */
export async function openOutboxDb(): Promise<Sql> {
  const db = await connect({ path: OUTBOX_PATH });
  const sql = toSql(db);
  await ensureOutboxSchema(sql);
  return sql;
}
