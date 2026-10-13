import { describe, expect, it } from 'vitest';
import type { ExceptionType } from '#/domain/types';
import { type StatusKind, statusColor } from '#/ui/status';
import { TOKENS } from '#/ui/theme';

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

  it('uses white on danger and ok, ink elsewhere, in light mode', () => {
    for (const k of ALL) {
      const fill = statusColor(k).fill;
      const white = fill === 'danger' || fill === 'ok';
      expect(statusColor(k).text.light).toBe(white ? '#ffffff' : '#1c1917');
    }
  });
});

describe('--fi-on-* tokens mirror statusColor text', () => {
  for (const scheme of ['light', 'dark'] as const) {
    for (const kind of ALL) {
      it(`${kind} ${scheme}`, () => {
        const { fill, text } = statusColor(kind);
        const key = `on-${fill}` as keyof (typeof TOKENS)[typeof scheme];
        expect(TOKENS[scheme][key]).toBe(text[scheme]);
      });
    }
  }
});
