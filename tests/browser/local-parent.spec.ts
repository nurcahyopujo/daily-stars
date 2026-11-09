import { expect, test } from '@playwright/test';

test.use({ baseURL: 'http://127.0.0.1:4174' });

test('local dev renders a synthetic parent without browser request interception', async ({ page, request }, testInfo) => {
  const response = await request.get('/api/me');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({
    email: 'local-parent@example.test',
    today: new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Asia/Jakarta', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(new Date()),
    timezone: 'Asia/Jakarta',
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
  await expect(page.getByText('local-parent@example.test')).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('local-parent.png'), fullPage: true });
});

test('local session mock does not unlock Worker routes or unsupported methods', async ({ request }) => {
  for (const path of ['/api/health', '/api/me/nested']) {
    const response = await request.get(path);
    expect([401, 503]).toContain(response.status());
  }
  const response = await request.post('/api/me', { data: {} });
  expect([401, 503]).toContain(response.status());
  const foreignHost = await request.get('/api/me', { headers: { Host: 'untrusted.example.test' } });
  expect(foreignHost.status()).not.toBe(200);
});
