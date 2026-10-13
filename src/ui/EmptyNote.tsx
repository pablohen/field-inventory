import { Text } from '@mantine/core';
import type { ReactNode } from 'react';

/** Empty-state line with the signage triangle; the glyph is decorative. */
export function EmptyNote({ children }: { children: ReactNode }) {
  return (
    <Text c="dimmed">
      <span aria-hidden="true">▲ </span>
      {children}
    </Text>
  );
}
