import { z } from 'zod';

// Client-safe: route and component files import this, never count-tasks.server.ts.

// Strict so that mixed input such as { locations, skus } is rejected on create
// rather than silently stripped. Reading stored scopes stays lenient.
export const countScopeSchema = z.union([
  z.object({ locations: z.array(z.string().min(1)).min(1) }).strict(),
  z.object({ zone: z.string().min(1) }).strict(),
  z.object({ skus: z.array(z.string().min(1)).min(1) }).strict(),
]);
export type CountScope = z.infer<typeof countScopeSchema>;

/** One-line description of a stored (lenient) scope; null/malformed is unreadable. */
export function scopeSummary(scope: unknown, malformed?: boolean): string {
  const UNREADABLE = 'Unreadable scope';
  if (malformed || typeof scope !== 'object' || scope === null) {
    return UNREADABLE;
  }
  const s = scope as Record<string, unknown>;
  if (typeof s.zone === 'string' && s.zone !== '') return `Zone ${s.zone}`;
  const parts: string[] = [];
  if (Array.isArray(s.locations)) parts.push(`${s.locations.length} bins`);
  if (Array.isArray(s.skus)) parts.push(`${s.skus.length} SKUs`);
  return parts.length > 0 ? parts.join(' · ') : UNREADABLE;
}
