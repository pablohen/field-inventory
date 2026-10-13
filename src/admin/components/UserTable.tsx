import { Button, Group, Select, Table, Tooltip } from '@mantine/core';
import { useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { ROLE_OPTIONS } from '#/admin/components/UserForm';
import { roleSchema } from '#/admin/user-input';
import { DeskErrorAlert } from '#/desk/components/DeskErrorAlert';
import { deskCall } from '#/desk/desk-call';
import { runMutation } from '#/desk/run-mutation';
import { setUserDisabled, updateUser } from '#/server/admin/users.fn';
import type { AdminUserRow } from '#/server/admin/users.server';
import type { DeskError } from '#/server/desk/warehouses.server';
import { EmptyNote } from '#/ui/EmptyNote';
import { StatusBadge } from '#/ui/StatusBadge';

export const SELF_TIP = "You can't change your own access";

type PinTarget = { id: string; name: string };

export function UserTable({
  rows,
  currentUserId,
  onResetPin,
}: {
  rows: AdminUserRow[];
  currentUserId: string;
  onResetPin: (user: PinTarget) => void;
}) {
  if (rows.length === 0) return <EmptyNote>No users.</EmptyNote>;
  return (
    <Table.ScrollContainer minWidth={760}>
      <Table highlightOnHover>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>Name</Table.Th>
            <Table.Th>Username</Table.Th>
            <Table.Th>Role</Table.Th>
            <Table.Th>Status</Table.Th>
            <Table.Th>Actions</Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {rows.map((r) => (
            <UserRowView
              key={r.id}
              row={r}
              own={r.id === currentUserId}
              onResetPin={onResetPin}
            />
          ))}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function UserRowView({
  row,
  own,
  onResetPin,
}: {
  row: AdminUserRow;
  own: boolean;
  onResetPin: (user: PinTarget) => void;
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState(false);
  const inFlight = useRef(false);
  const [error, setError] = useState<Pick<
    DeskError,
    'code' | 'message'
  > | null>(null);

  async function run(fn: () => Promise<{ ok: true } | DeskError>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const res = await runMutation(fn, setError);
      if (res === undefined) return;
      // The Select is controlled by the row, so a refusal leaves the old role.
      await qc.invalidateQueries({ queryKey: ['admin', 'users'] });
      if (!res.ok) setError(res);
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }

  function changeRole(v: string | null) {
    const role = roleSchema.safeParse(v);
    if (!role.success || role.data === row.role) return;
    void run(() => deskCall(updateUser, { userId: row.id, role: role.data }));
  }

  return (
    <>
      <Table.Tr>
        <Table.Td>{row.name}</Table.Td>
        <Table.Td>{row.username}</Table.Td>
        <Table.Td>
          <Tooltip label={SELF_TIP} disabled={!own}>
            <span>
              <Select
                aria-label={`Role for ${row.username}`}
                size="xs"
                w={130}
                data={ROLE_OPTIONS}
                value={row.role}
                allowDeselect={false}
                disabled={own || pending}
                onChange={changeRole}
              />
            </span>
          </Tooltip>
        </Table.Td>
        <Table.Td>
          <Group gap={4}>
            {row.disabled && (
              <StatusBadge kind="resolved">Disabled</StatusBadge>
            )}
            {row.locked && <StatusBadge kind="attention">Locked</StatusBadge>}
          </Group>
        </Table.Td>
        <Table.Td>
          <Group gap="xs">
            <Button
              size="xs"
              variant="default"
              disabled={pending}
              aria-label={`Reset PIN for ${row.username}`}
              onClick={() => onResetPin({ id: row.id, name: row.name })}
            >
              Reset PIN
            </Button>
            <Tooltip label={SELF_TIP} disabled={!own}>
              <span>
                <Button
                  size="xs"
                  variant="light"
                  color={row.disabled ? 'green' : 'red'}
                  disabled={own || pending}
                  loading={pending}
                  aria-label={`${row.disabled ? 'Enable' : 'Disable'} ${row.username}`}
                  onClick={() =>
                    void run(() =>
                      deskCall(setUserDisabled, {
                        userId: row.id,
                        disabled: !row.disabled,
                      }),
                    )
                  }
                >
                  {row.disabled ? 'Enable' : 'Disable'}
                </Button>
              </span>
            </Tooltip>
          </Group>
        </Table.Td>
      </Table.Tr>
      {error && (
        <Table.Tr>
          <Table.Td colSpan={5}>
            <DeskErrorAlert error={error} />
          </Table.Td>
        </Table.Tr>
      )}
    </>
  );
}
