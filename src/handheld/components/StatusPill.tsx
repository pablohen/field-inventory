import { Button, Group } from '@mantine/core';
import {
  ArrowsClockwiseIcon,
  CheckCircleIcon,
  CloudArrowUpIcon,
  type Icon,
  WarningCircleIcon,
} from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { TOUCH } from '#/handheld/touch';
import { StatusBadge } from '#/ui/StatusBadge';
import { useHandheld } from '../context';
import { STALE_WARNING_MS } from '../sync-loop';

/** Compact badge inside a 48px tap area. */
const LINK_STYLE = {
  ...TOUCH,
  display: 'inline-flex',
  alignItems: 'center',
  textDecoration: 'none',
} as const;

type Status = 'synced' | 'pending' | 'attention';

const STATUS_ICON: Record<Status, Icon> = {
  synced: CheckCircleIcon,
  pending: CloudArrowUpIcon,
  attention: WarningCircleIcon,
};

/** The overall status as a shape too, so it is not carried by colour alone. */
function StatusIcon({ status }: { status: Status }) {
  const Glyph = STATUS_ICON[status];
  return (
    <Glyph
      size={18}
      weight="bold"
      aria-hidden="true"
      data-icon={status}
      style={{ color: 'var(--fi-signal)' }}
    />
  );
}

function overallStatus(attention: boolean, pending: boolean): Status {
  if (attention) return 'attention';
  return pending ? 'pending' : 'synced';
}

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
      <Group gap="xs" data-status="pending">
        <StatusIcon status="pending" />
        <StatusBadge kind="resolved">Starting…</StatusBadge>
      </Group>
    );
  }

  const isOnline = online && syncState.phase !== 'offline';
  const stale =
    syncState.lastPullAt !== null &&
    now - Date.parse(syncState.lastPullAt) > STALE_WARNING_MS;
  const blocked =
    syncState.phase === 'device_revoked' ||
    syncState.phase === 'device_unknown';
  const status = overallStatus(
    blocked || syncState.attentionCount > 0,
    syncState.pendingCount > 0,
  );

  return (
    <Group gap="xs" wrap="wrap" data-status={status}>
      <StatusIcon status={status} />
      <StatusBadge kind={isOnline ? 'synced' : 'resolved'}>
        {isOnline ? 'Online' : 'Offline'}
      </StatusBadge>
      <StatusBadge kind={syncState.pendingCount > 0 ? 'pending' : 'synced'}>
        {syncState.pendingCount} pending
      </StatusBadge>
      {syncState.attentionCount > 0 && (
        <Link to="/h/attention" style={LINK_STYLE}>
          <StatusBadge kind="attention">
            {syncState.attentionCount} need attention
          </StatusBadge>
        </Link>
      )}
      {syncState.phase === 'needs_sign_in' && (
        <Link to="/h/login" style={LINK_STYLE}>
          <StatusBadge kind="pending">Sign in to sync</StatusBadge>
        </Link>
      )}
      {blocked && (
        <Link to="/h/attention" style={LINK_STYLE}>
          <StatusBadge kind="attention">
            {syncState.phase === 'device_revoked'
              ? 'Device revoked'
              : 'Device not enrolled'}
          </StatusBadge>
        </Link>
      )}
      {syncState.phase === 'update_required' && (
        <StatusBadge kind="pending">Update required</StatusBadge>
      )}
      {stale && <StatusBadge kind="pending">Data is stale</StatusBadge>}
      <StatusBadge kind="resolved">
        {syncState.lastPullAt
          ? `Synced ${relativeTime(syncState.lastPullAt, now)}`
          : 'Never synced'}
      </StatusBadge>
      <Button
        style={TOUCH}
        size="compact-xs"
        variant="light"
        leftSection={
          <ArrowsClockwiseIcon size={14} weight="bold" aria-hidden="true" />
        }
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
