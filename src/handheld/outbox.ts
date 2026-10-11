import { type MovementInput, movementInputSchema } from '#/domain/schemas';
import type { Sql } from './sql';

export type OutboxStatus = 'pending' | 'needs_attention';

type OutboxBase = {
  id: string;
  warehouseId: string;
  status: OutboxStatus;
  lastError: string | null;
  createdAt: string;
};

/** A row whose stored JSON parses as a valid `MovementInput` (dates revived as Date). */
export type ValidOutboxRow = OutboxBase & { input: MovementInput };

/**
 * A row whose stored `input` no longer parses (corruption). It is never
 * dropped: it is listed with status `needs_attention`, lastError
 * `CORRUPT_ROW`, and the unparsed stored text under `input.raw`.
 */
export type CorruptOutboxRow = OutboxBase & {
  input: { raw: string };
  corrupt: true;
};

export type OutboxRow = ValidOutboxRow | CorruptOutboxRow;

export const CORRUPT_ROW = 'CORRUPT_ROW';

export class StorageFullError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'StorageFullError';
  }
}

function isStorageFull(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'QuotaExceededError' || /quota|SQLITE_FULL/i.test(err.message)
  );
}

async function guardedRun(
  sql: Sql,
  statement: string,
  params?: unknown[],
): Promise<void> {
  try {
    await sql.run(statement, params);
  } catch (err) {
    if (isStorageFull(err)) {
      throw new StorageFullError('Device storage is full', { cause: err });
    }
    throw err;
  }
}

export async function ensureOutboxSchema(sql: Sql): Promise<void> {
  await guardedRun(
    sql,
    `CREATE TABLE IF NOT EXISTS outbox (
      id TEXT PRIMARY KEY,
      warehouseId TEXT NOT NULL,
      input TEXT NOT NULL,
      status TEXT NOT NULL,
      lastError TEXT,
      createdAt TEXT NOT NULL
    )`,
  );
}

/** Throws ZodError if invalid. An existing id is a no-op. */
export async function addToOutbox(
  sql: Sql,
  input: MovementInput,
  now: Date,
): Promise<void> {
  const valid = movementInputSchema.parse(input);
  await guardedRun(
    sql,
    `INSERT OR IGNORE INTO outbox (id, warehouseId, input, status, lastError, createdAt)
     VALUES (?, ?, ?, 'pending', NULL, ?)`,
    [valid.id, valid.warehouseId, JSON.stringify(valid), now.toISOString()],
  );
}

type RawRow = {
  id: string;
  warehouseId: string;
  input: string;
  status: string;
  lastError: string | null;
  createdAt: string;
};

function toRow(raw: RawRow): OutboxRow {
  const base = {
    id: raw.id,
    warehouseId: raw.warehouseId,
    lastError: raw.lastError,
    createdAt: raw.createdAt,
  };
  try {
    const parsed = movementInputSchema.safeParse(JSON.parse(raw.input));
    if (parsed.success) {
      return {
        ...base,
        status:
          raw.status === 'needs_attention' ? 'needs_attention' : 'pending',
        input: parsed.data,
      };
    }
  } catch {
    // fall through to the corrupt row
  }
  return {
    ...base,
    status: 'needs_attention',
    lastError: CORRUPT_ROW,
    input: { raw: raw.input },
    corrupt: true,
  };
}

export async function listOutbox(
  sql: Sql,
  filter: { warehouseId?: string; status?: OutboxStatus } = {},
): Promise<OutboxRow[]> {
  const where: string[] = [];
  const params: unknown[] = [];
  if (filter.warehouseId !== undefined) {
    where.push('warehouseId = ?');
    params.push(filter.warehouseId);
  }
  const raws = await sql.all<RawRow>(
    `SELECT id, warehouseId, input, status, lastError, createdAt FROM outbox${
      where.length ? ` WHERE ${where.join(' AND ')}` : ''
    } ORDER BY createdAt, id`,
    params,
  );
  // Status is filtered after parsing so corrupt rows (reported as needs_attention) match.
  return raws
    .map(toRow)
    .filter((r) => filter.status === undefined || r.status === filter.status);
}

/** Ids not in the outbox are ignored. */
export async function markNeedsAttention(
  sql: Sql,
  results: { id: string; reason: string }[],
): Promise<void> {
  for (const { id, reason } of results) {
    await guardedRun(
      sql,
      "UPDATE outbox SET status = 'needs_attention', lastError = ? WHERE id = ?",
      [reason, id],
    );
  }
}

export async function deleteOutbox(sql: Sql, ids: string[]): Promise<void> {
  for (const id of ids) await sql.run('DELETE FROM outbox WHERE id = ?', [id]);
}

export async function discardOutbox(sql: Sql, id: string): Promise<void> {
  await deleteOutbox(sql, [id]);
}

/** Pretty JSON (2-space indent) of all rows as listed. */
export async function exportOutbox(sql: Sql): Promise<string> {
  return JSON.stringify(await listOutbox(sql), null, 2);
}
