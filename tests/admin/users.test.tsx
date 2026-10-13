// @vitest-environment jsdom
import { MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AdminUserRow } from '#/server/admin/users.server';

const fns = vi.hoisted(() => ({
  listUsers: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  resetPin: vi.fn(),
  setUserDisabled: vi.fn(),
}));
vi.mock('#/server/admin/users.fn', () => fns);

import { UserTable } from '#/admin/components/UserTable';
import { UsersPage } from '#/routes/admin/users';

beforeAll(() => {
  Element.prototype.scrollIntoView = () => {};
  window.scrollTo = () => {};
  window.matchMedia ??= ((q: string) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
    onchange: null,
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const row = (over: Partial<AdminUserRow>): AdminUserRow => ({
  id: 'u1',
  username: 'ann',
  name: 'Ann',
  role: 'supervisor',
  disabled: false,
  locked: false,
  ...over,
});

const newClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

function mount(ui: ReactNode, client = newClient()) {
  render(
    <QueryClientProvider client={client}>
      <MantineProvider>{ui}</MantineProvider>
    </QueryClientProvider>,
  );
  return client;
}

const rows = [
  row({ id: 'me', username: 'root', name: 'Root', role: 'admin' }),
  row({ id: 'u1', username: 'ann', name: 'Ann' }),
];

async function typePin(pin: string) {
  await screen.findAllByLabelText('PIN digit');
  const inputs = document.querySelectorAll<HTMLInputElement>(
    'input[type="password"]',
  );
  expect(inputs).toHaveLength(4);
  [...pin].forEach((d, i) => {
    fireEvent.change(inputs[i], { target: { value: d } });
  });
}

describe('UserTable', () => {
  it('disables the own row role and disable controls only', () => {
    mount(<UserTable rows={rows} currentUserId="me" onResetPin={() => {}} />);
    expect(
      (
        screen.getByRole('combobox', {
          name: 'Role for root',
        }) as HTMLInputElement
      ).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText('Disable root') as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      (screen.getByLabelText('Reset PIN for root') as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    expect(
      (
        screen.getByRole('combobox', {
          name: 'Role for ann',
        }) as HTMLInputElement
      ).disabled,
    ).toBe(false);
    expect(
      (screen.getByLabelText('Disable ann') as HTMLButtonElement).disabled,
    ).toBe(false);
  });

  it('explains the own-row lock in a tooltip', async () => {
    mount(<UserTable rows={rows} currentUserId="me" onResetPin={() => {}} />);
    const wrapper = screen.getByLabelText('Disable root').parentElement;
    if (!wrapper) throw new Error('no wrapper');
    fireEvent.mouseEnter(wrapper);
    expect(
      await screen.findByText("You can't change your own access"),
    ).toBeTruthy();
  });

  it('shows Disabled and Locked badges and an Enable action', () => {
    mount(
      <UserTable
        rows={[row({ disabled: true, locked: true })]}
        currentUserId="me"
        onResetPin={() => {}}
      />,
    );
    expect(screen.getByText('Disabled')).toBeTruthy();
    expect(screen.getByText('Locked')).toBeTruthy();
    expect(screen.getByLabelText('Enable ann')).toBeTruthy();
  });

  it('shows a guard INVALID in an Alert and keeps the old role', async () => {
    fns.updateUser.mockResolvedValue({
      ok: false,
      code: 'INVALID',
      message: 'At least one active admin is required',
    });
    const client = newClient();
    const spy = vi.spyOn(client, 'invalidateQueries');
    mount(
      <UserTable
        rows={[row({ id: 'a2', username: 'bob', name: 'Bob', role: 'admin' })]}
        currentUserId="me"
        onResetPin={() => {}}
      />,
      client,
    );
    fireEvent.click(screen.getByRole('combobox', { name: 'Role for bob' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Worker' }));
    await waitFor(() =>
      expect(fns.updateUser).toHaveBeenCalledWith(
        expect.objectContaining({ data: { userId: 'a2', role: 'worker' } }),
      ),
    );
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('At least one active admin');
    expect(
      (
        screen.getByRole('combobox', {
          name: 'Role for bob',
        }) as HTMLInputElement
      ).value,
    ).toBe('Admin');
    expect(spy).toHaveBeenCalledWith({ queryKey: ['admin', 'users'] });
  });

  it('Disable calls the fn with the toggled flag', async () => {
    fns.setUserDisabled.mockResolvedValue({ ok: true });
    mount(<UserTable rows={rows} currentUserId="me" onResetPin={() => {}} />);
    fireEvent.click(screen.getByLabelText('Disable ann'));
    await waitFor(() =>
      expect(fns.setUserDisabled).toHaveBeenCalledWith(
        expect.objectContaining({ data: { userId: 'u1', disabled: true } }),
      ),
    );
  });
});

describe('UsersPage', () => {
  it('Reset PIN posts a 4-digit PIN and shows the success text', async () => {
    fns.listUsers.mockResolvedValue({ ok: true, users: rows });
    fns.resetPin.mockResolvedValue({ ok: true });
    mount(<UsersPage currentUserId="me" />);
    fireEvent.click(await screen.findByLabelText('Reset PIN for ann'));
    await typePin('4821');
    fireEvent.click(await screen.findByRole('button', { name: 'Reset PIN' }));
    await waitFor(() =>
      expect(fns.resetPin).toHaveBeenCalledWith(
        expect.objectContaining({ data: { userId: 'u1', pin: '4821' } }),
      ),
    );
    expect(
      await screen.findByText('PIN reset; the account is unlocked'),
    ).toBeTruthy();
  });

  it('creates a user from the drawer', async () => {
    fns.listUsers.mockResolvedValue({ ok: true, users: rows });
    fns.createUser.mockResolvedValue({ ok: true, id: 'user-zed' });
    mount(<UsersPage currentUserId="me" />);
    fireEvent.click(await screen.findByText('New user'));
    fireEvent.change(await screen.findByLabelText('Username'), {
      target: { value: 'zed' },
    });
    fireEvent.change(screen.getByLabelText('Name'), {
      target: { value: 'Zed' },
    });
    await typePin('1234');
    fireEvent.click(screen.getByRole('button', { name: 'Create user' }));
    await waitFor(() =>
      expect(fns.createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          data: { username: 'zed', name: 'Zed', role: 'worker', pin: '1234' },
        }),
      ),
    );
  });

  it('shows the error Alert only when there is no data', async () => {
    fns.listUsers.mockRejectedValue(new Error('boom'));
    mount(<UsersPage currentUserId="me" />);
    expect((await screen.findByRole('alert')).textContent).toContain('boom');
  });
});
