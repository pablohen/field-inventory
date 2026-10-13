import { Group } from '@mantine/core';
import { Link } from '@tanstack/react-router';

const LINKS = [
  { to: '/admin/warehouses', label: 'Warehouses' },
  { to: '/admin/users', label: 'Users' },
  { to: '/admin/devices', label: 'Devices' },
  { to: '/admin/products', label: 'Products' },
  { to: '/admin/categories', label: 'Categories' },
  { to: '/admin/reason-codes', label: 'Reason codes' },
] as const;

export function AdminNav() {
  return (
    <Group gap="md" wrap="wrap">
      {LINKS.map((l) => (
        <Link key={l.to} to={l.to} activeProps={{ style: { fontWeight: 700 } }}>
          {l.label}
        </Link>
      ))}
    </Group>
  );
}
