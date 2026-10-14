import { Button, Group } from '@mantine/core';
import {
  ArrowsLeftRightIcon,
  ClipboardTextIcon,
  HandGrabbingIcon,
  type Icon,
  PackageIcon,
  PlusMinusIcon,
  TruckIcon,
} from '@phosphor-icons/react';
import { Link } from '@tanstack/react-router';
import { TOUCH } from '#/handheld/touch';

type Action = {
  label: string;
  to:
    | '/h/$wh/stock'
    | '/h/$wh/count'
    | '/h/$wh/move'
    | '/h/$wh/transfer-in'
    | '/h/$wh/pick'
    | '/h/$wh/adjust';
  icon: Icon;
};

const ACTIONS: Action[] = [
  { label: 'Stock', to: '/h/$wh/stock', icon: PackageIcon },
  { label: 'Count', to: '/h/$wh/count', icon: ClipboardTextIcon },
  { label: 'Move', to: '/h/$wh/move', icon: ArrowsLeftRightIcon },
  { label: 'Transfer in', to: '/h/$wh/transfer-in', icon: TruckIcon },
  { label: 'Pick', to: '/h/$wh/pick', icon: HandGrabbingIcon },
  { label: 'Adjust', to: '/h/$wh/adjust', icon: PlusMinusIcon },
];

/** The per-warehouse actions on the handheld home; Stock is the primary one. */
export function WarehouseActions({ wh }: { wh: string }) {
  return (
    <Group gap="xs" data-tour="warehouse-actions">
      {ACTIONS.map(({ label, to, icon: Glyph }, i) => (
        <Button
          key={to}
          style={TOUCH}
          renderRoot={(props) => <Link to={to} params={{ wh }} {...props} />}
          size="compact-md"
          variant={i === 0 ? 'filled' : 'light'}
          leftSection={<Glyph size={18} weight="bold" aria-hidden="true" />}
        >
          {label}
        </Button>
      ))}
    </Group>
  );
}
