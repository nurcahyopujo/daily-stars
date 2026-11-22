import { expect, test } from '@playwright/test';

test('the built app serves its standalone manifest and home-screen icons', async ({ page, request }) => {
  await page.goto('/');
  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveAttribute('crossorigin', 'use-credentials');
  await expect(manifestLink).toHaveAttribute('href', '/manifest.webmanifest');
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', '/apple-touch-icon.png');

  const manifest = await request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect(manifest.headers()['content-type']).toMatch(/^application\/(?:manifest\+)?json\b/);
  expect(await manifest.json()).toMatchObject({
    name: 'Daily Stars',
    start_url: '/',
    display: 'standalone',
    icons: [
      { src: '/icon-192.png', sizes: '192x192' },
      { src: '/icon-512.png', sizes: '512x512' },
      { src: '/icon-maskable-512.png', sizes: '512x512', purpose: 'maskable' },
    ],
  });

  for (const [path, size] of [
    ['/icon-192.png', 192],
    ['/icon-512.png', 512],
    ['/icon-maskable-512.png', 512],
    ['/apple-touch-icon.png', 180],
  ] as const) {
    const image = await request.get(path);
    expect(image.ok()).toBe(true);
    expect(image.headers()['content-type']).toBe('image/png');
    const png = await image.body();
    expect(png.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([size, size]);
  }
});
