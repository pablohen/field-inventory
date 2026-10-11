import { createContext, useContext } from 'react';
import type { HandheldBackend } from './leader';
import type { LeaderApi } from './leader-api';
import type { CachedSession } from './session-store';
import type { SyncState } from './sync-loop';

export type BannerKind = 'capabilities' | 'storage' | null;

export type HandheldValue = {
  /** Null until the leader election finishes (or when there is no device id). */
  backend: HandheldBackend<LeaderApi> | null;
  syncState: SyncState | null;
  session: CachedSession | null;
  banner: BannerKind;
  setBanner(banner: BannerKind): void;
};

export const HandheldContext = createContext<HandheldValue | null>(null);

export function useHandheld(): HandheldValue {
  const v = useContext(HandheldContext);
  if (!v) throw new Error('useHandheld must be used inside <HandheldProvider>');
  return v;
}
