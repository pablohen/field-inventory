import { useHandheld } from './context';

export type LookupResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

export type FoundLocation = { id: string; code: string };
export type FoundProduct = { id: string; sku: string; name: string };

/** Scan lookups for the action screens. Errors are user-facing messages; nothing is recorded here. */
export function useLookups(wh: string) {
  const { backend } = useHandheld();

  const location = async (
    scan: string,
  ): Promise<LookupResult<FoundLocation>> => {
    if (!backend) return { ok: false, error: 'Not ready yet' };
    const loc = await backend.call('findLocation', wh, scan);
    if (!loc) return { ok: false, error: `Not found: ${scan}` };
    if (!loc.active) return { ok: false, error: 'Location inactive' };
    return { ok: true, value: { id: loc.id, code: loc.code } };
  };

  const product = async (scan: string): Promise<LookupResult<FoundProduct>> => {
    if (!backend) return { ok: false, error: 'Not ready yet' };
    const p = await backend.call('findProduct', scan);
    if (!p) return { ok: false, error: `Not found: ${scan}` };
    return { ok: true, value: p };
  };

  return { location, product };
}
