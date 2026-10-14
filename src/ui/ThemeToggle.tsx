import {
  ActionIcon,
  type MantineColorScheme,
  SegmentedControl,
  useMantineColorScheme,
} from '@mantine/core';
import { useMounted } from '@mantine/hooks';

const ORDER = ['light', 'dark', 'auto'] as const;
const LABEL: Record<MantineColorScheme, string> = {
  light: 'Light',
  dark: 'Dark',
  auto: 'Auto',
};
const ICON: Record<MantineColorScheme, string> = {
  light: '☀',
  dark: '☾',
  auto: 'A',
};

/**
 * Light / Dark / Auto. The choice is stored per device by Mantine's colour
 * scheme manager and applied before paint by `ColorSchemeScript`.
 * `segmented` suits the desk rail and login; `cycle` is one 48px button for
 * the handheld status bar.
 */
export function ThemeToggle({ variant }: { variant: 'segmented' | 'cycle' }) {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  // The server renders "auto"; show the stored choice only after mount so
  // hydration never mismatches.
  const mounted = useMounted();
  const current: MantineColorScheme = mounted ? colorScheme : 'auto';

  if (variant === 'segmented') {
    return (
      <SegmentedControl
        aria-label="Theme"
        className="fi-theme-seg"
        size="xs"
        color="signal"
        value={current}
        onChange={(v) => setColorScheme(v as MantineColorScheme)}
        data={ORDER.map((v) => ({ value: v, label: LABEL[v] }))}
      />
    );
  }

  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  return (
    <ActionIcon
      variant="subtle"
      className="fi-theme-cycle"
      aria-label={`Theme: ${LABEL[current]}. Switch to ${LABEL[next]}`}
      onClick={() => setColorScheme(next)}
      style={{ minHeight: 48, minWidth: 48, color: 'var(--fi-signal)' }}
    >
      <span aria-hidden="true">{ICON[current]}</span>
    </ActionIcon>
  );
}
