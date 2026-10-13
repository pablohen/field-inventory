import { createTheme, type MantineColorsTuple } from '@mantine/core';

export type TokenName =
  | 'bg'
  | 'surface'
  | 'ink'
  | 'muted'
  | 'rule'
  | 'signal'
  | 'rail'
  | 'danger'
  | 'ok'
  | 'resolved'
  | 'btn-bg'
  | 'btn-fg';

/** Single source of truth for the §3.1 colour tokens; tokens.css mirrors it. */
export const TOKENS: Record<'light' | 'dark', Record<TokenName, string>> = {
  light: {
    bg: '#f4f1ea',
    surface: '#fffdf8',
    ink: '#1c1917',
    muted: '#57534e',
    rule: '#d6d3d1',
    signal: '#facc15',
    rail: '#1c1917',
    danger: '#dc2626',
    ok: '#15803d',
    resolved: '#d6d3d1',
    'btn-bg': '#1c1917',
    'btn-fg': '#facc15',
  },
  dark: {
    bg: '#0c0a09',
    surface: '#1c1917',
    ink: '#e7e5e4',
    muted: '#a8a29e',
    rule: '#44403c',
    signal: '#facc15',
    rail: '#000000',
    danger: '#f87171',
    ok: '#4ade80',
    resolved: '#44403c',
    'btn-bg': '#facc15',
    'btn-fg': '#1c1917',
  },
};

const stone: MantineColorsTuple = [
  '#fafaf9',
  '#f5f5f4',
  '#e7e5e4',
  '#d6d3d1',
  '#a8a29e',
  '#78716c',
  '#57534e',
  '#44403c',
  '#292524',
  '#1c1917',
];

const signal: MantineColorsTuple = [
  '#fefce8',
  '#fef9c3',
  '#fef08a',
  '#fde047',
  '#facc15',
  '#eab308',
  '#ca8a04',
  '#a16207',
  '#854d0e',
  '#713f12',
];

const CONDENSED = {
  textTransform: 'uppercase' as const,
  fontWeight: 800,
  fontStretch: '75%',
  letterSpacing: '0.04em',
};

const INK_BORDER = { border: '2px solid var(--fi-ink)' };

export const theme = createTheme({
  colors: { stone, signal },
  primaryColor: 'signal',
  primaryShade: 4,
  autoContrast: true,
  fontFamily: "'Archivo Variable', system-ui, sans-serif",
  headings: { fontFamily: "'Archivo Variable', system-ui, sans-serif" },
  defaultRadius: 'sm',
  components: {
    Button: {
      vars: (_theme: unknown, props: { variant?: string }) =>
        props.variant === undefined || props.variant === 'filled'
          ? {
              root: {
                '--button-bg': 'var(--fi-btn-bg)',
                '--button-hover': 'var(--fi-btn-bg)',
                '--button-color': 'var(--fi-btn-fg)',
                '--button-bd': '2px solid var(--fi-ink)',
              },
            }
          : { root: {} },
      styles: {
        root: CONDENSED,
      },
    },
    Badge: {
      defaultProps: { radius: 0 },
      styles: { root: { fontWeight: 800 } },
    },
    Table: {
      defaultProps: { borderColor: 'var(--fi-rule)' },
      styles: {
        table: INK_BORDER,
        th: {
          ...CONDENSED,
          fontSize: 12,
          color: 'var(--fi-muted)',
          borderBottom: '2px solid var(--fi-ink)',
        },
        td: { borderBottom: '1px solid var(--fi-rule)' },
      },
    },
    Title: { styles: { root: CONDENSED } },
    TextInput: { styles: { input: INK_BORDER } },
    PasswordInput: { styles: { input: INK_BORDER } },
    NumberInput: { styles: { input: INK_BORDER } },
    Select: { styles: { input: INK_BORDER } },
    PinInput: { styles: { input: INK_BORDER } },
    Drawer: { styles: { content: INK_BORDER, title: CONDENSED } },
    Modal: { styles: { content: INK_BORDER, title: CONDENSED } },
  },
});
