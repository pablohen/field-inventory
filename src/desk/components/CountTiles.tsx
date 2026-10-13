import { Group, UnstyledButton, useComputedColorScheme } from '@mantine/core';
import { statusColor } from '#/ui/status';

/**
 * One signage tile per type: filled when non-zero, outlined when zero.
 * A value of undefined means "still loading" and renders as an outlined "…".
 * Pass onSelect to make the tiles act as toggle buttons.
 */
export function CountTiles({
  counts,
  active,
  onSelect,
}: {
  counts: Record<string, number | undefined>;
  active?: string;
  onSelect?: (type: string) => void;
}) {
  const scheme = useComputedColorScheme('light');
  return (
    <Group gap="xs">
      {Object.entries(counts).map(([t, n]) => {
        const filled = n !== undefined && n > 0;
        const { fill, text } = statusColor(t);
        return (
          <UnstyledButton
            key={t}
            type="button"
            className="fi-num"
            data-filled={filled ? 'true' : 'false'}
            aria-pressed={onSelect ? active === t : undefined}
            aria-label={`${t} ${n ?? '…'}`}
            onClick={onSelect ? () => onSelect(t) : undefined}
            style={{
              border: '2px solid var(--fi-ink)',
              padding: '4px 10px',
              fontWeight: 800,
              fontSize: 13,
              cursor: onSelect ? 'pointer' : 'default',
              backgroundColor: filled ? `var(--fi-${fill})` : 'transparent',
              color: filled ? text[scheme] : 'var(--fi-ink)',
              outline: active === t ? '2px solid var(--fi-ink)' : undefined,
              outlineOffset: 2,
            }}
          >
            {t} {n ?? '…'}
          </UnstyledButton>
        );
      })}
    </Group>
  );
}
