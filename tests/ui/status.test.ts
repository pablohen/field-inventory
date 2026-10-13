import { describe, expect, it } from 'vitest';
import type { ExceptionType } from '#/domain/types';
import { type StatusKind, statusColor } from '#/ui/status';

const EXCEPTIONS: ExceptionType[] = [
  'NEGATIVE_BALANCE',
  'COUNT_VARIANCE',
  'LATE_MOVEMENT',
  'OVER_PICK',
  'TRANSFER_STUCK',
  'CLOCK_SKEW',
];
const ALL: StatusKind[] = [
  ...EXCEPTIONS,
  'pending',
  'synced',
  'attention',
  'resolved',
];

describe('statusColor', () => {
  it('maps each kind to its fixed fill', () => {
    expect(statusColor('NEGATIVE_BALANCE').fill).toBe('danger');
    expect(statusColor('attention').fill).toBe('danger');
    expect(statusColor('synced').fill).toBe('ok');
    expect(statusColor('resolved').fill).toBe('resolved');
    for (const k of [
      'COUNT_VARIANCE',
      'LATE_MOVEMENT',
      'OVER_PICK',
      'TRANSFER_STUCK',
      'CLOCK_SKEW',
      'pending',
    ]) {
      expect(statusColor(k).fill).toBe('signal');
    }
  });

  it('falls back to signal for unknown kinds without throwing', () => {
    expect(() => statusColor('SOMETHING_NEW')).not.toThrow();
    expect(statusColor('SOMETHING_NEW').fill).toBe('signal');
  });

  it('uses fixed dark-mode badge text', () => {
    for (const k of ALL) {
      expect(statusColor(k).text.dark).toBe(
        k === 'resolved' ? '#e7e5e4' : '#1c1917',
      );
    }
  });

  it('uses white on danger and ink elsewhere in light mode', () => {
    for (const k of ALL) {
      const danger = statusColor(k).fill === 'danger';
      expect(statusColor(k).text.light).toBe(danger ? '#ffffff' : '#1c1917');
    }
  });
});
