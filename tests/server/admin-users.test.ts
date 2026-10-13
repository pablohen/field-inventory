import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createUserInputSchema,
  updateUserInputSchema,
} from '#/admin/user-input';
import {
  createUserCore,
  handleCreateUser,
  handleListUsers,
  handleResetPin,
  handleSetUserDisabled,
  handleUpdateUser,
  listUsersAdminCore,
  resetPinCore,
  setUserDisabledCore,
  type UserDeps,
  updateUserCore,
} from '#/server/admin/users.server';
import { loginCore } from '#/server/auth/login-core';
import type { SessionClaims } from '#/server/auth/session';
import type { DeskSession } from '#/server/desk/session';
import { createTestEnv, type TestEnv } from '../support/test-env';

const NOW = new Date('2026-03-01T12:00:00Z');
const claims = (
  userId: string,
  role: SessionClaims['role'],
): SessionClaims => ({
  userId,
  deviceId: 'desk',
  role,
  exp: 0,
});
const actorOf = (userId: string): DeskSession => ({
  userId,
  deviceId: 'desk',
  role: 'admin',
  exp: 0,
});
const INVALID = (message: string) => ({ ok: false, code: 'INVALID', message });
const SELF = "You can't change your own access";
const LAST = 'At least one active admin is required';

describe('user input schemas', () => {
  const base = { username: 'bob', name: 'Bob', role: 'worker', pin: '1234' };
  it.each([
    { username: 'Bob' },
    { username: '1bob' },
    { username: 'b' },
    { username: 'x'.repeat(33) },
    { name: '' },
    { name: 'n'.repeat(81) },
    { role: 'root' },
    { pin: '123' },
    { pin: '12345' },
    { pin: 'abcd' },
  ])('rejects %j', (patch) => {
    expect(createUserInputSchema.safeParse({ ...base, ...patch }).success).toBe(
      false,
    );
  });
  it('accepts a valid input; update fields are optional', () => {
    expect(createUserInputSchema.safeParse(base).success).toBe(true);
    expect(updateUserInputSchema.parse({})).toEqual({});
  });
});

describe('users admin', () => {
  let env: TestEnv;
  let deps: UserDeps;

  beforeEach(async () => {
    vi.stubEnv('SESSION_SECRET', 'a'.repeat(40));
    env = await createTestEnv();
    await env.seedDevice({ id: 'dev1', warehouses: [] });
    await env.seedUser({ id: 'worker', username: 'worker', pin: '1111' });
    await env.seedUser({
      id: 'supervisor',
      username: 'supervisor',
      pin: '2222',
      role: 'supervisor',
    });
    await env.seedUser({
      id: 'admin',
      username: 'admin',
      pin: '3333',
      role: 'admin',
    });
    deps = { global: env.global, now: () => NOW };
  });
  afterEach(async () => {
    vi.unstubAllEnvs();
    await env.cleanup();
  });

  const login = (username: string, pin: string) =>
    loginCore(deps, { username, pin, deviceId: 'dev1' });

  it('creates a user whose PIN works with loginCore', async () => {
    const r = await createUserCore(deps, {
      username: 'new.user',
      name: 'New User',
      role: 'worker',
      pin: '4321',
    });
    expect(r).toEqual({ ok: true, id: 'user-new.user' });
    expect((await login('new.user', '4321')).ok).toBe(true);
    expect((await login('new.user', '0000')).ok).toBe(false);
  });

  it('rejects a duplicate username', async () => {
    expect(
      await createUserCore(deps, {
        username: 'worker',
        name: 'Dup',
        role: 'worker',
        pin: '1234',
      }),
    ).toEqual(INVALID('Username worker is already taken'));
  });

  it('falls back to user-<u>-2 when the id is taken', async () => {
    await env.global.user.create({
      data: {
        id: 'user-ann',
        name: 'x',
        username: 'someone-else',
        pinHash: 'x',
        role: 'worker',
      },
    });
    expect(
      await createUserCore(deps, {
        username: 'ann',
        name: 'Ann',
        role: 'worker',
        pin: '1234',
      }),
    ).toEqual({ ok: true, id: 'user-ann-2' });
  });

  it('lists ordered by name, reports locked/disabled, never pinHash', async () => {
    await env.global.user.update({
      where: { id: 'worker' },
      data: { name: 'Zed', disabledAt: NOW },
    });
    await env.global.loginAttempt.createMany({
      data: [
        {
          deviceId: 'dev1',
          username: 'supervisor',
          failures: 5,
          lockedUntil: new Date(NOW.getTime() + 60_000),
        },
        {
          deviceId: 'dev1',
          username: 'admin',
          failures: 5,
          lockedUntil: new Date(NOW.getTime() - 60_000),
        },
      ],
    });
    const r = await listUsersAdminCore(deps);
    expect(r.users.map((u) => u.username)).toEqual([
      'admin',
      'supervisor',
      'worker',
    ]);
    expect(r.users.map((u) => [u.username, u.locked, u.disabled])).toEqual([
      ['admin', false, false],
      ['supervisor', true, false],
      ['worker', false, true],
    ]);
    expect(JSON.stringify(r)).not.toContain('pinHash');
    expect(r.users[0]).not.toHaveProperty('pinHash');
  });

  it('updates name and role of another user', async () => {
    expect(
      await updateUserCore(deps, actorOf('admin'), 'worker', {
        name: 'Wanda',
        role: 'supervisor',
      }),
    ).toEqual({ ok: true });
    const u = await env.global.user.findUnique({ where: { id: 'worker' } });
    expect([u?.name, u?.role]).toEqual(['Wanda', 'supervisor']);
    expect(
      await updateUserCore(deps, actorOf('admin'), 'nope', { name: 'X' }),
    ).toMatchObject({ ok: false, code: 'NOT_FOUND' });
  });

  describe('guards', () => {
    it('self-disable and self-demote are INVALID', async () => {
      await env.global.user.update({
        where: { id: 'supervisor' },
        data: { role: 'admin' },
      });
      expect(
        await setUserDisabledCore(deps, actorOf('admin'), 'admin', true),
      ).toEqual(INVALID(SELF));
      expect(
        await updateUserCore(deps, actorOf('admin'), 'admin', {
          role: 'worker',
        }),
      ).toEqual(INVALID(SELF));
      // renaming yourself is fine
      expect(
        await updateUserCore(deps, actorOf('admin'), 'admin', { name: 'Me' }),
      ).toEqual({ ok: true });
    });

    it('demoting or disabling the last other admin is INVALID', async () => {
      // `admin` is the only admin; an actor that is not it tries to remove it.
      const actor = actorOf('supervisor');
      expect(
        await updateUserCore(deps, actor, 'admin', { role: 'worker' }),
      ).toEqual(INVALID(LAST));
      expect(await setUserDisabledCore(deps, actor, 'admin', true)).toEqual(
        INVALID(LAST),
      );
      const u = await env.global.user.findUnique({ where: { id: 'admin' } });
      expect([u?.role, u?.disabledAt]).toEqual(['admin', null]);
    });

    it('allows demoting an admin when another active admin remains', async () => {
      await env.global.user.update({
        where: { id: 'supervisor' },
        data: { role: 'admin' },
      });
      expect(
        await updateUserCore(deps, actorOf('admin'), 'supervisor', {
          role: 'worker',
        }),
      ).toEqual({ ok: true });
    });

    it('a disabled admin does not count', async () => {
      await env.global.user.update({
        where: { id: 'supervisor' },
        data: { role: 'admin', disabledAt: NOW },
      });
      expect(
        await updateUserCore(deps, actorOf('supervisor'), 'admin', {
          role: 'worker',
        }),
      ).toEqual(INVALID(LAST));
    });

    it('concurrent mutual demotion leaves exactly one admin', async () => {
      await env.global.user.update({
        where: { id: 'supervisor' },
        data: { role: 'admin' },
      });
      // admin + supervisor are both admins; each demotes the other.
      const results = await Promise.all([
        updateUserCore(deps, actorOf('admin'), 'supervisor', {
          role: 'worker',
        }),
        updateUserCore(deps, actorOf('supervisor'), 'admin', {
          role: 'worker',
        }),
      ]);
      expect(results.filter((r) => r.ok).length).toBeLessThanOrEqual(1);
      expect(results.filter((r) => !r.ok).length).toBeGreaterThanOrEqual(1);
      const admins = await env.global.user.count({
        where: { role: 'admin', disabledAt: null },
      });
      expect(admins).toBe(1);
    });

    it('concurrent mutual disable leaves exactly one admin', async () => {
      await env.global.user.update({
        where: { id: 'supervisor' },
        data: { role: 'admin' },
      });
      const results = await Promise.all([
        setUserDisabledCore(deps, actorOf('admin'), 'supervisor', true),
        setUserDisabledCore(deps, actorOf('supervisor'), 'admin', true),
      ]);
      expect(results.filter((r) => !r.ok).length).toBeGreaterThanOrEqual(1);
      const admins = await env.global.user.count({
        where: { role: 'admin', disabledAt: null },
      });
      expect(admins).toBe(1);
    });
  });

  it('disable and enable round-trip', async () => {
    expect(
      await setUserDisabledCore(deps, actorOf('admin'), 'worker', true),
    ).toEqual({ ok: true });
    expect(
      (await env.global.user.findUnique({ where: { id: 'worker' } }))
        ?.disabledAt,
    ).toEqual(NOW);
    expect((await login('worker', '1111')).ok).toBe(false);
    expect(
      await setUserDisabledCore(deps, actorOf('admin'), 'worker', false),
    ).toEqual({ ok: true });
    expect(
      (await env.global.user.findUnique({ where: { id: 'worker' } }))
        ?.disabledAt,
    ).toBeNull();
    expect((await login('worker', '1111')).ok).toBe(true);
  });

  it('demoting a supervisor makes their next desk call 403', async () => {
    const sup = claims('supervisor', 'supervisor');
    expect(
      ((await handleListUsers(sup, {}, deps).catch((e) => e)) as Response)
        .status,
    ).toBe(403);
    // supervisor is already refused here (admin-only); check the desk guard too
    const { authorizeDesk } = await import('#/server/auth/authorize');
    await expect(authorizeDesk(sup, env.global)).resolves.toBeTruthy();
    await handleUpdateUser(
      claims('admin', 'admin'),
      { userId: 'supervisor', role: 'worker' },
      deps,
    );
    const err = (await authorizeDesk(sup, env.global).catch(
      (e) => e,
    )) as Response;
    expect(err.status).toBe(403);
  });

  it('resetPin unlocks everywhere and the new PIN works', async () => {
    const until = new Date(Date.now() + 60 * 60_000);
    await env.global.loginAttempt.createMany({
      data: [
        {
          deviceId: 'dev1',
          username: 'worker',
          failures: 5,
          lockedUntil: until,
        },
        { deviceId: '*', username: 'worker', failures: 10, lockedUntil: until },
        {
          deviceId: 'desk',
          username: 'worker',
          failures: 5,
          lockedUntil: until,
        },
        { deviceId: 'dev1', username: 'admin', failures: 2 },
      ],
    });
    const realDeps = { ...deps, now: () => new Date() };
    expect(
      (await listUsersAdminCore(realDeps)).users.find(
        (u) => u.username === 'worker',
      )?.locked,
    ).toBe(true);
    expect((await login('worker', '1111')).ok).toBe(false);

    expect(await resetPinCore(deps, 'worker', '9876')).toEqual({ ok: true });

    expect(
      await env.global.loginAttempt.count({ where: { username: 'worker' } }),
    ).toBe(0);
    // other users' attempts are untouched
    expect(
      await env.global.loginAttempt.count({ where: { username: 'admin' } }),
    ).toBe(1);
    expect((await login('worker', '9876')).ok).toBe(true);
    expect((await login('worker', '1111')).ok).toBe(false);
  });

  it('resetPin rejects a bad PIN and an unknown user', async () => {
    expect(await resetPinCore(deps, 'worker', '12')).toEqual(
      INVALID('PIN must be 4 digits'),
    );
    expect(await resetPinCore(deps, 'nope', '1234')).toMatchObject({
      ok: false,
      code: 'NOT_FOUND',
    });
  });

  it('handlers work for an admin and use the DB role', async () => {
    const admin = claims('admin', 'admin');
    expect((await handleListUsers(admin, {}, deps)).users).toHaveLength(3);
    expect(
      await handleCreateUser(
        admin,
        { username: 'zed', name: 'Zed', role: 'worker', pin: '1234' },
        deps,
      ),
    ).toEqual({ ok: true, id: 'user-zed' });
    expect(
      await handleSetUserDisabled(
        admin,
        { userId: 'admin', disabled: true },
        deps,
      ),
    ).toEqual(INVALID(SELF));
    expect(
      await handleResetPin(admin, { userId: 'user-zed', pin: '5555' }, deps),
    ).toEqual({
      ok: true,
    });
  });

  describe('admin-only authorization', () => {
    const calls: [string, (c: SessionClaims | null) => Promise<unknown>][] = [
      ['list', (c) => handleListUsers(c, {}, deps)],
      [
        'create',
        (c) =>
          handleCreateUser(
            c,
            { username: 'qq', name: 'Q', role: 'worker', pin: '1234' },
            deps,
          ),
      ],
      [
        'update',
        (c) => handleUpdateUser(c, { userId: 'worker', name: 'X' }, deps),
      ],
      [
        'resetPin',
        (c) => handleResetPin(c, { userId: 'worker', pin: '1234' }, deps),
      ],
      [
        'setDisabled',
        (c) =>
          handleSetUserDisabled(c, { userId: 'worker', disabled: true }, deps),
      ],
    ];
    it.each(calls)('%s: supervisor gets 403', async (_n, call) => {
      const err = (await call(claims('supervisor', 'supervisor')).catch(
        (e) => e,
      )) as Response;
      expect(err).toBeInstanceOf(Response);
      expect(err.status).toBe(403);
    });
    it.each(calls)(
      '%s: a token claiming admin but DB worker gets 403',
      async (_n, call) => {
        const err = (await call(claims('worker', 'admin')).catch(
          (e) => e,
        )) as Response;
        expect(err.status).toBe(403);
      },
    );
    it.each(calls)('%s: no session gets 401', async (_n, call) => {
      const err = (await call(null).catch((e) => e)) as Response;
      expect(err.status).toBe(401);
    });
  });
});
