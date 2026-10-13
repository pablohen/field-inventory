import { describe, expect, it } from 'vitest';
import { RAIL_ACTIVE_INK, RAIL_LINK_COLOR } from '#/ui/AppShellSidebar';
import { PITCH_COLOR } from '#/ui/AuthSplit';
import { contrastRatio } from '#/ui/contrast';
import { type StatusKind, statusColor } from '#/ui/status';
import { TOKENS, theme } from '#/ui/theme';

const KINDS: StatusKind[] = [
  'NEGATIVE_BALANCE',
  'COUNT_VARIANCE',
  'LATE_MOVEMENT',
  'OVER_PICK',
  'TRANSFER_STUCK',
  'CLOCK_SKEW',
  'pending',
  'synced',
  'attention',
  'resolved',
];

describe('autoContrast', () => {
  it('resolves to dark text on the signal fill', () => {
    const signal = theme.colors?.signal?.[4] ?? '';
    const dark = '#1c1917';
    expect(contrastRatio(dark, signal)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#ffffff', signal)).toBeLessThan(4.5);
    expect(theme.autoContrast).toBe(true);
  });
});

describe('contrastRatio', () => {
  it('is 21 for black on white', () => {
    expect(contrastRatio('#000', '#fff')).toBeCloseTo(21, 1);
  });
});

for (const scheme of ['light', 'dark'] as const) {
  describe(`${scheme} tokens`, () => {
    const t = TOKENS[scheme];

    it('body text pairs meet AA 4.5', () => {
      expect(contrastRatio(t.ink, t.bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.ink, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.muted, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.danger, t.surface)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(t.signal, t.rail)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(PITCH_COLOR, t.rail)).toBeGreaterThanOrEqual(4.5);
    });

    it('rail link pairs meet AA 4.5', () => {
      expect(contrastRatio(RAIL_LINK_COLOR, t.rail)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrastRatio(RAIL_ACTIVE_INK, t.signal)).toBeGreaterThanOrEqual(
        4.5,
      );
    });

    it('button fill/text pair meets AA 4.5', () => {
      expect(contrastRatio(t['btn-fg'], t['btn-bg'])).toBeGreaterThanOrEqual(
        4.5,
      );
    });

    for (const kind of KINDS) {
      it(`badge text for ${kind} is legible`, () => {
        const s = statusColor(kind);
        const ratio = contrastRatio(s.text[scheme], t[s.fill]);
        // Badge labels are small text: every pair must reach AA 4.5.
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      });
    }
  });
}
