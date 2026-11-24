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

test('recovers an uncertain day outcome by retrying with the original action', async ({ page, request }) => {
  const origin = 'http://127.0.0.1:4174';
  const name = 'Score recovery ' + crypto.randomUUID();
  const created = await request.post(origin + '/api/children', {
    headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
    data: { displayName: name, initialTemplateIds: ['33333333-3333-4333-8333-333333333333'] },
  });
  expect(created.status()).toBe(201);

  // Fail the first outcome save so it lands "uncertain", and capture the
  // idempotency key of every outcome PUT to prove the retry replays the original.
  const keys: string[] = [];
  let failNext = true;
  await page.route('**/days/**', (route) => {
    if (route.request().method() !== 'PUT') return route.continue();
    keys.push(route.request().headers()['idempotency-key']);
    if (failNext) { failNext = false; return route.abort('failed'); }
    return route.continue();
  });

  await page.goto(origin + '/');
  const row = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name, exact: true }) });
  const card = await row.boundingBox();
  await row.click({ position: { x: card!.width - 10, y: 10 } });

  const activity = page.locator('article').filter({ has: page.getByRole('heading', { name: 'Make the bed' }) });
  await expect(activity.getByText('Pending', { exact: true })).toBeVisible();
  await activity.getByRole('button', { name: /Done correctly/ }).click();

  // The optimistic award shows immediately, but the save is unconfirmed.
  await expect(activity.getByLabel('5 stars', { exact: true })).toBeVisible();
  await expect(page.getByText('Save not confirmed. Keep this page open and retry.')).toBeVisible();

  // Check / retry replays the same action and confirms it; the award persists.
  await page.getByRole('button', { name: 'Check / retry' }).click();
  await expect(page.getByText('Save not confirmed. Keep this page open and retry.')).toBeHidden();
  await expect(activity.getByLabel('5 stars', { exact: true })).toBeVisible();
  expect(keys).toEqual([keys[0], keys[0]]);

  await page.reload();
  await expect(activity.getByLabel('5 stars', { exact: true })).toBeVisible();
});
