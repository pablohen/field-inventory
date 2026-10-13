import { Group, UnstyledButton } from '@mantine/core';
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
  return (
    <Group gap="xs">
      {Object.entries(counts).map(([t, n]) => {
        const filled = n !== undefined && n > 0;
        const { fill } = statusColor(t);
        return (
          <UnstyledButton
            key={t}
            type="button"
            className="fi-num"
            data-active={active === t ? 'true' : undefined}
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
              color: filled ? `var(--fi-on-${fill})` : 'var(--fi-ink)',
              boxShadow:
                active === t ? 'inset 0 0 0 3px var(--fi-ink)' : undefined,
            }}
          >
            {t} {n ?? '…'}
          </UnstyledButton>
        );
      })}
    </Group>
  );
}
