import {
  type CreateUserInput,
  createUserInputSchema,
  type UpdateUserInput,
  updateUserInputSchema,
} from '#/admin/user-input';
import { authorizeAdmin } from '#/server/auth/authorize';
import { hashPin } from '#/server/auth/password';
import type { Role, SessionClaims } from '#/server/auth/session';
import type { GlobalClient } from '#/server/db/clients';
import type { DeskSession } from '#/server/desk/session';
import type { DeskError } from '#/server/desk/warehouses.server';

export type UserDeps = { global: GlobalClient; now(): Date };

export type AdminUserRow = {
  id: string;
  username: string;
  name: string;
  role: Role;
  disabled: boolean;
  locked: boolean;
};

const invalid = (message: string): DeskError => ({
  ok: false,
  code: 'INVALID',
  message,
});
const notFound: DeskError = {
  ok: false,
  code: 'NOT_FOUND',
  message: 'User not found',
};
const SELF = "You can't change your own access";
const LAST_ADMIN = 'At least one active admin is required';

/** Thrown inside a transaction to roll it back with a typed result. */
class Abort extends Error {
  constructor(readonly error: DeskError) {
    super(error.message);
  }
}

function isUniqueViolation(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    (e as { code?: unknown }).code === 'P2002'
  );
}

const duplicate = (username: string): DeskError =>
  invalid(`Username ${username} is already taken`);

export async function listUsersAdminCore(
  deps: Pick<UserDeps, 'global'> & { now?: () => Date },
): Promise<{ ok: true; users: AdminUserRow[] }> {
  const now = deps.now?.() ?? new Date();
  const [users, locks] = await Promise.all([
    deps.global.user.findMany({
      orderBy: { username: 'asc' },
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        disabledAt: true,
      },
    }),
    deps.global.loginAttempt.findMany({
      where: { lockedUntil: { gt: now } },
      select: { username: true },
    }),
  ]);
  const locked = new Set(locks.map((l) => l.username));
  // Case-insensitive by name (SQLite's default collation puts capitals first).
  users.sort(
    (a, b) =>
      a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) ||
      a.username.localeCompare(b.username),
  );
  return {
    ok: true,
    users: users.map((u) => ({
      id: u.id,
      username: u.username,
      name: u.name,
      role: u.role as Role,
      disabled: u.disabledAt !== null,
      locked: locked.has(u.username),
    })),
  };
}

export async function createUserCore(
  deps: Pick<UserDeps, 'global'>,
  input: CreateUserInput,
): Promise<{ ok: true; id: string } | DeskError> {
  const { username, name, role, pin } = createUserInputSchema.parse(input);
  const byUsername = () => deps.global.user.findUnique({ where: { username } });
  if (await byUsername()) return duplicate(username);
  const pinHash = await hashPin(pin);
  const base = `user-${username}`;
  const used = new Set(
    (
      await deps.global.user.findMany({
        where: { id: { startsWith: base } },
        select: { id: true },
      })
    ).map((u) => u.id),
  );
  let id = base;
  for (let n = 2; used.has(id); n++) id = `${base}-${n}`;
  try {
    await deps.global.user.create({
      data: { id, username, name, role, pinHash, disabledAt: null },
    });
  } catch (e) {
    if (isUniqueViolation(e) && (await byUsername())) {
      return duplicate(username);
    }
    throw e;
  }
  return { ok: true, id };
}

/**
 * Applies `data` to the user and then, in the same transaction, verifies an
 * active admin remains. The write comes first so concurrent demotions
 * serialize on the write lock; the loser re-counts after the winner commits
 * and rolls back if it would leave zero.
 */
async function guardedUserUpdate(
  global: GlobalClient,
  userId: string,
  data: { name?: string; role?: Role; disabledAt?: Date | null },
): Promise<{ ok: true } | DeskError> {
  try {
    await global.$transaction(async (tx) => {
      const res = await tx.user.updateMany({ where: { id: userId }, data });
      if (res.count === 0) throw new Abort(notFound);
      const admins = await tx.user.count({
        where: { role: 'admin', disabledAt: null },
      });
      if (admins === 0) throw new Abort(invalid(LAST_ADMIN));
    });
  } catch (e) {
    if (e instanceof Abort) return e.error;
    throw e;
  }
  return { ok: true };
}

export async function updateUserCore(
  deps: Pick<UserDeps, 'global'>,
  actor: DeskSession,
  userId: string,
  input: UpdateUserInput,
): Promise<{ ok: true } | DeskError> {
  const { name, role } = updateUserInputSchema.parse(input);
  if (role !== undefined && userId === actor.userId) return invalid(SELF);
  const data: { name?: string; role?: Role } = {};
  if (name !== undefined) data.name = name;
  if (role !== undefined) data.role = role;
  if (Object.keys(data).length === 0) {
    const u = await deps.global.user.findUnique({ where: { id: userId } });
    return u ? { ok: true } : notFound;
  }
  return guardedUserUpdate(deps.global, userId, data);
}

export async function resetPinCore(
  deps: Pick<UserDeps, 'global'>,
  userId: string,
  pin: string,
): Promise<{ ok: true } | DeskError> {
  if (!/^\d{4}$/.test(pin)) return invalid('PIN must be 4 digits');
  const user = await deps.global.user.findUnique({ where: { id: userId } });
  if (!user) return notFound;
  const pinHash = await hashPin(pin);
  await deps.global.$transaction([
    deps.global.user.update({ where: { id: userId }, data: { pinHash } }),
    // Every device key, including '*' and 'desk'.
    deps.global.loginAttempt.deleteMany({ where: { username: user.username } }),
  ]);
  return { ok: true };
}

export async function setUserDisabledCore(
  deps: UserDeps,
  actor: DeskSession,
  userId: string,
  disabled: boolean,
): Promise<{ ok: true } | DeskError> {
  if (disabled && userId === actor.userId) return invalid(SELF);
  return guardedUserUpdate(deps.global, userId, {
    disabledAt: disabled ? deps.now() : null,
  });
}

export async function handleListUsers(
  claims: SessionClaims | null,
  _input: Record<string, never>,
  deps: UserDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return listUsersAdminCore(deps);
}

export async function handleCreateUser(
  claims: SessionClaims | null,
  input: CreateUserInput,
  deps: UserDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return createUserCore(deps, input);
}

export async function handleUpdateUser(
  claims: SessionClaims | null,
  input: { userId: string } & UpdateUserInput,
  deps: UserDeps,
) {
  const actor = await authorizeAdmin(claims, deps.global);
  const { userId, ...rest } = input;
  return updateUserCore(deps, actor, userId, rest);
}

export async function handleResetPin(
  claims: SessionClaims | null,
  input: { userId: string; pin: string },
  deps: UserDeps,
) {
  await authorizeAdmin(claims, deps.global);
  return resetPinCore(deps, input.userId, input.pin);
}

export async function handleSetUserDisabled(
  claims: SessionClaims | null,
  input: { userId: string; disabled: boolean },
  deps: UserDeps,
) {
  const actor = await authorizeAdmin(claims, deps.global);
  return setUserDisabledCore(deps, actor, input.userId, input.disabled);
}
