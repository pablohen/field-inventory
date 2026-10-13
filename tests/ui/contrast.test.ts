import { describe, expect, it } from 'vitest';
import { contrastRatio } from '#/ui/contrast';
import { type StatusKind, statusColor } from '#/ui/status';
import { TOKENS } from '#/ui/theme';

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
    });

    for (const kind of KINDS) {
      it(`badge text for ${kind} is legible`, () => {
        const s = statusColor(kind);
        const ratio = contrastRatio(s.text[scheme], t[s.fill]);
        // Light "synced" is spec-mandated ink on green (3.49:1): an 800-weight
        // badge label, so it is held to the 3:1 non-body threshold.
        const min = scheme === 'light' && kind === 'synced' ? 3 : 4.5;
        expect(ratio).toBeGreaterThanOrEqual(min);
      });
    }
  });
}
