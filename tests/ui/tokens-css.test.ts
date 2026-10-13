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
