import { expect, test } from '@playwright/test';

test('the handheld shell reloads offline and stays cross-origin isolated', async ({
  page,
  context,
}) => {
  await page.goto('/h/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  // Reload so the page is controlled by the service worker.
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();

  await expect(page.getByLabel('Username')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);
});

test('offline opens of /h and a never-visited /h/... URL render from the shell', async ({
  page,
  context,
}) => {
  await page.goto('/h/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
  // A cached session, so /h and /h/attention don't redirect to the login.
  await page.evaluate(() => {
    localStorage.setItem(
      'fi:session',
      JSON.stringify({
        userId: 'u1',
        name: 'Test',
        role: 'operator',
        deviceId: 'd1',
        expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    );
  });

  await context.setOffline(true);

  // Never visited online: only the shared cached /h document can serve it.
  await page.goto('/h/attention');
  await expect(
    page.getByRole('heading', { name: 'Needs attention' }),
  ).toBeVisible();
  expect(await page.evaluate(() => crossOriginIsolated)).toBe(true);

  // The installed app's start_url.
  await page.goto('/h');
  await expect(page.getByText('Field Inventory').first()).toBeVisible();
  expect(page.url()).toMatch(/\/h$/);
});

test('navigations never write the shell cache; only the install does', async ({
  page,
}) => {
  await page.goto('/h/login');
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await page.goto('/h/attention');
  const shell = await page.evaluate(async () => {
    const out: Record<string, string[]> = {};
    for (const name of await caches.keys()) {
      if (!name.startsWith('fi-shell')) continue;
      out[name] = (await (await caches.open(name)).keys()).map(
        (r) => new URL(r.url).pathname,
      );
    }
    return out;
  });
  const names = Object.keys(shell);
  expect(names).toHaveLength(1);
  expect(names[0]).toMatch(/^fi-shell-[0-9a-f]{8}$/);
  expect(shell[names[0]]).toEqual(['/h']);
});
