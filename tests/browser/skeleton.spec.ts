import { expect, test } from '@playwright/test';

test('built shell renders at phone width without runtime errors', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page).toHaveTitle('Daily Stars');
  await expect(page.getByRole('heading', { name: 'Small steps. Bright days.' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Your family’s story starts here' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
  await page.screenshot({ path: testInfo.outputPath('shell.png'), fullPage: true });
});

test('built Worker health uses local D1 and API misses stay JSON', async ({ request, page }) => {
  const response = await request.get('/api/health');
  expect(response.status()).toBe(200);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(await response.json()).toEqual({ status: 'ok', database: 'ok' });

  // Navigation requests must not receive index.html from SPA fallback.
  for (const path of ['/api', '/api/unknown', '/api/health/nested']) {
    const missing = await page.goto(path);
    expect(missing?.status()).toBe(404);
    expect(missing?.headers()['content-type']).toContain('application/json');
    expect(await missing?.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
  }

  const rejected = await request.post('/api/health');
  expect(rejected.status()).toBe(404);
  expect(await rejected.json()).toMatchObject({ error: { code: 'NOT_FOUND' } });
});
