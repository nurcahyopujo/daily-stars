import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';

const parent = {
  email: 'synthetic-parent-with-a-long-address@example.test',
  today: '2026-11-09',
  timezone: 'Asia/Jakarta',
};

test('built app denies anonymous API access and offers unavailable-state recovery', async ({ page, request }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.route('**/api/me', (route) => route.fulfill({
    status: 503, json: { error: { code: 'AUTH_UNAVAILABLE' } },
  }));
  await page.goto('/');
  await expect(page).toHaveTitle('Daily Stars');
  await expect(page.getByRole('heading', { name: 'Small steps. Bright days.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'We couldn’t check your access' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('unavailable.png'), fullPage: true });

  for (const path of ['/api', '/api/me', '/api/health', '/api/unknown']) {
    const response = await request.get(path, { headers: { Accept: 'text/html' } });
    expect([401, 503]).toContain(response.status());
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()['content-type']).toContain('application/json');
    expect(await response.json()).toMatchObject({
      error: { code: response.status() === 401 ? 'SIGN_IN_REQUIRED' : 'AUTH_UNAVAILABLE' },
    });
  }
});

test('shows verified identity at phone width and signs out by navigation', async ({ page }, testInfo) => {
  await page.route('**/api/me', (route) => route.fulfill({ json: parent }));
  await page.route('**/cdn-cgi/access/logout', (route) => route.fulfill({
    contentType: 'text/html', body: '<h1>Signed out fixture</h1>',
  }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
  await expect(page.getByText(parent.email)).toBeVisible();
  await expect(page.getByText('Today: 2026-11-09 · Jakarta')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const signOut = page.getByRole('button', { name: 'Sign out' });
  await signOut.focus();
  await expect(signOut).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('signed-in.png'), fullPage: true });
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(/\/cdn-cgi\/access\/logout$/);
  await expect(page.getByText(parent.email)).toHaveCount(0);
});

for (const challenge of ['unauthorized', 'forbidden', 'html']) {
  test(`offers sign-in for an ${challenge} challenge without navigating automatically`, async ({ page }, testInfo) => {
    await page.route('**/api/me', (route) => {
      if (challenge === 'html') return route.fulfill({ contentType: 'text/html', body: '<h1>Access login</h1>' });
      return route.fulfill({ status: challenge === 'unauthorized' ? 401 : 403, json: {} });
    });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
    const signIn = page.getByRole('link', { name: 'Sign in' });
    await expect(signIn).toHaveAttribute('href', '/');
    await signIn.focus();
    await expect(signIn).toBeFocused();
    if (challenge === 'html') {
      await page.screenshot({ path: testInfo.outputPath('sign-in.png'), fullPage: true });
    }
  });
}

test('handles a real authentication redirect without following it', async ({ page }) => {
  // WebKit's request interception cannot fulfill synthetic 302 responses.
  const server = createServer((_request, response) => {
    response.writeHead(302, {
      Location: 'https://login.example.test/',
      'Access-Control-Allow-Origin': 'http://127.0.0.1:4173',
    });
    response.end();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Redirect fixture has no port.');
    await page.route('**/api/me', (route) => route.continue({ url: `http://127.0.0.1:${address.port}/` }));
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test('recovers from a failed fetch only when the parent retries', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/me', (route) => {
    requests++;
    return requests === 1 ? route.abort() : route.fulfill({ json: parent });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'We couldn’t check your access' })).toBeVisible();
  expect(requests).toBe(1);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByText(parent.email)).toBeVisible();
  expect(requests).toBe(2);
});

test('clears identity and rechecks access on page restoration', async ({ page }) => {
  let requests = 0;
  await page.route('**/api/me', (route) => {
    requests++;
    return requests === 1 ? route.fulfill({ json: parent }) : route.fulfill({ status: 401, json: {} });
  });
  await page.goto('/');
  await expect(page.getByText(parent.email)).toBeVisible();
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.getByText(parent.email)).toHaveCount(0);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  expect(requests).toBe(2);
});

test('does not display malformed identity data', async ({ page }) => {
  await page.route('**/api/me', (route) => route.fulfill({ json: { ...parent, email: 123 } }));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'We couldn’t check your access' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out' })).toHaveCount(0);
});
