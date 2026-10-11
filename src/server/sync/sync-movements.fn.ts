import { createServerFn } from '@tanstack/react-start';
import { ZodError } from 'zod';
import { syncBatchSchema } from '#/domain/schemas';
import type { ExceptionDraft } from '#/domain/types';
import { requireSession, type SessionClaims } from '#/server/auth/session';
import { catalogDb, globalDb, warehouseDb } from '#/server/db/clients';
import {
  type SyncDeps,
  type SyncResponse,
  syncMovementsCore,
} from './sync-movements';

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

/**
 * `ExceptionDraft.details` is `Record<string, unknown>`, which the server
 * function serializability check rejects; the values are JSON by construction.
 */
type WireSyncResponse =
  | (Omit<Extract<SyncResponse, { status: 'ok' }>, 'exceptions'> & {
      exceptions: (Omit<ExceptionDraft, 'details'> & {
        details: Record<string, Json>;
      })[];
    })
  | Exclude<SyncResponse, { status: 'ok' }>;

function numberFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

export function defaultDeps(): SyncDeps {
  return {
    global: globalDb(),
    catalog: catalogDb(),
    warehouseDb,
    now: () => new Date(),
    newId: () => crypto.randomUUID(),
    clockSkewThresholdMs: numberFromEnv('CLOCK_SKEW_THRESHOLD_MS', 120_000),
    transferStuckHours: numberFromEnv('TRANSFER_STUCK_HOURS', 24),
  };
}

/** Runs the sync; an invalid envelope (ZodError) becomes a 400 response. */
export async function handleSync(
  deps: SyncDeps,
  data: unknown,
  session: SessionClaims,
) {
  const envelope = syncBatchSchema.safeParse(data);
  if (envelope.success && envelope.data.deviceId !== session.deviceId) {
    throw new Response(JSON.stringify({ error: 'Session device mismatch' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  try {
    return await syncMovementsCore(deps, data);
  } catch (error) {
    if (error instanceof ZodError) {
      throw new Response(
        JSON.stringify({
          error: 'Invalid sync envelope',
          issues: error.issues,
        }),
        { status: 400, headers: { 'Content-Type': 'application/json' } },
      );
    }
    throw error;
  }
}

export const syncMovements = createServerFn({ method: 'POST' })
  .validator((d: unknown) => d)
  .handler(async ({ data }) => {
    const session = await requireSession();
    return handleSync(
      defaultDeps(),
      data,
      session,
    ) as Promise<WireSyncResponse>;
  });
