import { Badge, type BadgeProps } from '@mantine/core';
import type { ReactNode } from 'react';
import { statusColor } from '#/ui/status';

/** The only way desk/admin render a status badge: colours come from statusColor. */
export function StatusBadge({
  kind,
  children,
  size,
}: {
  kind: string;
  children: ReactNode;
  size?: BadgeProps['size'];
}) {
  const { fill } = statusColor(kind);
  return (
    <Badge
      size={size}
      variant="filled"
      style={{
        backgroundColor: `var(--fi-${fill})`,
        color: `var(--fi-on-${fill})`,
      }}
    >
      {children}
    </Badge>
  );
}
