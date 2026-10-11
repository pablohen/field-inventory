import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { checkCapabilities, type MissingCapability } from './capabilities';
import { BlockingBanner } from './components/BlockingBanner';
import {
  type BannerKind,
  HandheldContext,
  type HandheldValue,
  useHandheld,
} from './context';
import { electLeader, type HandheldBackend } from './leader';
import type { LeaderApi } from './leader-api';
import { getCachedSession, getDeviceId } from './session-store';
import type { SyncState } from './sync-loop';

export { useHandheld };

// One election per tab, even under StrictMode's double effect.
let booting: Promise<HandheldBackend<LeaderApi>> | null = null;
function bootBackend(deviceId: string) {
  booting ??= (async () => {
    const { startLeader } = await import('./leader-boot');
    return electLeader<LeaderApi>({
      locks: navigator.locks,
      channel: new BroadcastChannel('fi-sync'),
      onLeader: () => startLeader(deviceId),
    });
  })();
  booting.catch(() => {
    booting = null;
  });
  return booting;
}

export function HandheldProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  useState(() => {
    queryClient.setQueryDefaults(['h'], {
      networkMode: 'always',
      staleTime: 0,
    });
    queryClient.setMutationDefaults(['h'], { networkMode: 'always' });
  });

  const [backend, setBackend] = useState<HandheldBackend<LeaderApi> | null>(
    null,
  );
  const [session, setSession] = useState(getCachedSession);
  const [banner, setBanner] = useState<BannerKind>(null);
  const [missing, setMissing] = useState<MissingCapability[]>([]);

  useEffect(() => {
    const caps = checkCapabilities();
    if (!caps.ok) {
      setMissing(caps.missing);
      setBanner('capabilities');
      return;
    }
    const s = getCachedSession();
    setSession(s);
    const deviceId = getDeviceId() ?? s?.deviceId ?? null;
    if (!deviceId) return;
    let cancelled = false;
    bootBackend(deviceId).then(
      (b) => {
        if (!cancelled) setBackend(b);
      },
      (err) => console.error('Handheld backend failed to start', err),
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const { data: syncState } = useQuery<SyncState>({
    queryKey: ['h', 'sync'],
    queryFn: () => (backend as HandheldBackend<LeaderApi>).call('syncState'),
    enabled: backend !== null,
    refetchInterval: 2000,
  });

  const lastPullAt = syncState?.lastPullAt ?? null;
  const seenPull = useRef<string | null>(null);
  useEffect(() => {
    if (lastPullAt !== seenPull.current) {
      seenPull.current = lastPullAt;
      void queryClient.invalidateQueries({ queryKey: ['h'] });
    }
  }, [lastPullAt, queryClient]);

  const lastError = syncState?.lastError ?? null;
  useEffect(() => {
    if (lastError?.startsWith('StorageFullError')) setBanner('storage');
  }, [lastError]);

  const value = useMemo<HandheldValue>(
    () => ({
      backend,
      syncState: syncState ?? null,
      session,
      banner,
      setBanner,
    }),
    [backend, syncState, session, banner],
  );

  if (banner === 'capabilities') {
    return <BlockingBanner kind="capabilities" missing={missing} />;
  }
  return (
    <HandheldContext.Provider value={value}>
      {banner === 'storage' && (
        <BlockingBanner kind="storage" onDismiss={() => setBanner(null)} />
      )}
      {children}
    </HandheldContext.Provider>
  );
}
