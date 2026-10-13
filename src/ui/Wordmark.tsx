const SIZES = { sm: 16, md: 22, lg: 34 } as const;

/** Uppercase condensed brand mark; coloured `--fi-signal` for use on the rail. */
export function Wordmark({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      style={{
        color: 'var(--fi-signal)',
        fontSize: SIZES[size],
        fontWeight: 800,
        fontStretch: '75%',
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        lineHeight: 1.1,
      }}
    >
      ▲ Field Inventory
    </span>
  );
}
