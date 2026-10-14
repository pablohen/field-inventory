import {
  ActionIcon,
  Center,
  type MantineColorScheme,
  SegmentedControl,
  useMantineColorScheme,
  VisuallyHidden,
} from '@mantine/core';
import { useMounted } from '@mantine/hooks';
import {
  DesktopIcon,
  type Icon,
  MoonIcon,
  SunIcon,
} from '@phosphor-icons/react';

const ORDER = ['light', 'dark', 'auto'] as const;
const LABEL: Record<MantineColorScheme, string> = {
  light: 'Light',
  dark: 'Dark',
  auto: 'Auto',
};
const ICON: Record<MantineColorScheme, Icon> = {
  light: SunIcon,
  dark: MoonIcon,
  auto: DesktopIcon,
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
        data={ORDER.map((v) => {
          const Glyph = ICON[v];
          return {
            value: v,
            label: (
              <Center title={LABEL[v]}>
                <Glyph
                  size={16}
                  weight="bold"
                  aria-hidden="true"
                  data-icon={v}
                />
                <VisuallyHidden>{LABEL[v]}</VisuallyHidden>
              </Center>
            ),
          };
        })}
      />
    );
  }

  const next = ORDER[(ORDER.indexOf(current) + 1) % ORDER.length];
  const Glyph = ICON[current];
  return (
    <ActionIcon
      variant="subtle"
      className="fi-theme-cycle"
      aria-label={`Theme: ${LABEL[current]}. Switch to ${LABEL[next]}`}
      onClick={() => setColorScheme(next)}
      style={{ minHeight: 48, minWidth: 48, color: 'var(--fi-signal)' }}
    >
      <Glyph size={24} weight="bold" aria-hidden="true" data-icon={current} />
    </ActionIcon>
  );
}
