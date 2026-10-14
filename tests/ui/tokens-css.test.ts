import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { TOKENS } from '#/ui/theme';

const css = readFileSync('src/ui/tokens.css', 'utf8');

describe('tokens.css mirrors TOKENS', () => {
  for (const scheme of ['light', 'dark'] as const) {
    it(`${scheme} block has every token`, () => {
      const m = css.match(
        new RegExp(
          `\\[data-mantine-color-scheme=["']${scheme}["']\\]\\s*\\{([^}]*)\\}`,
        ),
      );
      expect(m).not.toBeNull();
      const block = m?.[1] ?? '';
      for (const [name, value] of Object.entries(TOKENS[scheme])) {
        expect(block).toContain(`--fi-${name}: ${value};`);
      }
    });
  }
});

describe('rail header', () => {
  it('is hidden from 900px up (jsdom cannot evaluate media queries)', () => {
    expect(css).toMatch(
      /@media \(min-width: 900px\)\s*\{\s*\.fi-rail-top\s*\{\s*display:\s*none;?\s*\}\s*\}/,
    );
  });
});

describe('collapsed drawer', () => {
  it('is visibility:hidden below 900px unless open', () => {
    expect(css).toMatch(
      /@media \(max-width: 899\.98px\)\s*\{\s*\.fi-rail:not\(\[data-open\]\)\s*\{\s*visibility:\s*hidden;/,
    );
  });
});

describe('colour defaults', () => {
  it('anchors default to ink, not the signal primary', () => {
    expect(css).toContain('--mantine-color-anchor: var(--fi-ink);');
  });
  it('inputs carry the border, focus ring and error colour in CSS', () => {
    expect(css).toMatch(/\.mantine-Input-input\s*\{[^}]*border-width: 2px/);
    expect(css).toMatch(
      /\.mantine-Input-input:focus-visible\s*\{[^}]*var\(--fi-signal\)/,
    );
    expect(css).toMatch(/\[data-error\][^{]*\{[^}]*var\(--fi-danger\)/);
  });
  it('has no dead rail-footer alert rule', () => {
    expect(css).not.toContain('[role="alert"]');
  });
});
