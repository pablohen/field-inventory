import { Badge, Button, Group } from '@mantine/core';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { useHandheld } from '../context';
import { STALE_WARNING_MS } from '../sync-loop';

export function relativeTime(iso: string, now: number): string {
  const diff = Math.max(0, now - Date.parse(iso));
  const min = Math.floor(diff / 60_000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h} h ago`;
  return `${Math.floor(h / 24)} d ago`;
}

function useOnline(): boolean {
  const [online, setOnline] = useState(
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );
  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);
  return online;
}

/** `now` (epoch ms) is for tests; by default it ticks every 30 s. */
export function StatusPill({ now: nowProp }: { now?: number }) {
  const { backend, syncState } = useHandheld();
  const online = useOnline();
  const [tick, setTick] = useState(() => Date.now());
  const [syncing, setSyncing] = useState(false);
  useEffect(() => {
    if (nowProp !== undefined) return;
    const t = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [nowProp]);
  const now = nowProp ?? tick;

  if (!backend || !syncState) {
    return (
      <Group gap="xs">
        <Badge color="gray">Starting…</Badge>
      </Group>
    );
  }

  const isOnline = online && syncState.phase !== 'offline';
  const stale =
    syncState.lastPullAt !== null &&
    now - Date.parse(syncState.lastPullAt) > STALE_WARNING_MS;

  return (
    <Group gap="xs" wrap="wrap">
      <Badge color={isOnline ? 'green' : 'gray'}>
        {isOnline ? 'Online' : 'Offline'}
      </Badge>
      <Badge color="blue" variant="light">
        {syncState.pendingCount} pending
      </Badge>
      {syncState.attentionCount > 0 && (
        <Badge
          color="red"
          component={Link}
          to="/h/attention"
          style={{ cursor: 'pointer' }}
        >
          {syncState.attentionCount} need attention
        </Badge>
      )}
      {syncState.phase === 'needs_sign_in' && (
        <Badge
          color="orange"
          component={Link}
          to="/h/login"
          style={{ cursor: 'pointer' }}
        >
          Sign in to sync
        </Badge>
      )}
      {(syncState.phase === 'device_revoked' ||
        syncState.phase === 'device_unknown') && (
        <Badge
          color="red"
          component={Link}
          to="/h/attention"
          style={{ cursor: 'pointer' }}
        >
          {syncState.phase === 'device_revoked'
            ? 'Device revoked'
            : 'Device not enrolled'}
        </Badge>
      )}
      {syncState.phase === 'update_required' && (
        <Badge color="orange">Update required</Badge>
      )}
      {stale && <Badge color="yellow">Data is stale</Badge>}
      <Badge color="gray" variant="outline">
        {syncState.lastPullAt
          ? `Synced ${relativeTime(syncState.lastPullAt, now)}`
          : 'Never synced'}
      </Badge>
      <Button
        size="compact-xs"
        variant="light"
        loading={syncing}
        onClick={() => {
          setSyncing(true);
          backend
            .call('syncNow')
            .catch((err) => console.error('Sync failed', err))
            .finally(() => setSyncing(false));
        }}
      >
        Sync now
      </Button>
    </Group>
  );
}
