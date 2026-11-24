import { test, expect } from '@playwright/test';

test('parent records a zero outcome and a one-off award, then sees the running total', async ({
  page,
  request,
}, info) => {
  const origin = 'http://127.0.0.1:4174';
  const name = 'Score test ' + crypto.randomUUID();
  const result = await request.post(origin + '/api/children', {
    headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
    data: { displayName: name, initialTemplateIds: ['33333333-3333-4333-8333-333333333333'] },
  });
  expect(result.status()).toBe(201);
  await page.goto(origin + '/');
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
  await expect(row.getByRole('link', { name, exact: true })).toHaveAccessibleDescription('View today →');
  const card = await row.boundingBox();
  expect(card).not.toBeNull();
  await row.click({ position: { x: card!.width - 10, y: 10 } });
  const activity = page
    .locator('article')
    .filter({ has: page.getByRole('heading', { name: 'Make the bed' }) });
  await expect(activity.getByText('Pending', { exact: true })).toBeVisible();
  await activity.getByRole('button', { name: /Needs improvement/ }).click();
  await expect(activity.getByLabel('0 stars', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Add stars', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Stars', exact: true }).fill('3');
  await page.getByLabel('Reason', { exact: true }).fill('Helped tidy up');
  await page.getByRole('button', { name: 'Review entry' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.locator('article').filter({ hasText: 'Helped tidy up' })).toContainText('★★★');
  await page.screenshot({ path: info.outputPath('day.png'), fullPage: true });
  await page.getByRole('link', { name: /All children/ }).click();
  await expect(row.getByLabel('3 stars')).toBeVisible();
});
