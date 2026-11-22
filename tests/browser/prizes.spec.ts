import { test, expect } from '@playwright/test';

test('parent redeems a prize and voids it to restore the balance', async ({ page, request }, info) => {
  const origin = 'http://127.0.0.1:4174';
  const response = await request.post(origin + '/api/children', {
    headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
    data: { displayName: 'Prize child ' + crypto.randomUUID(), initialTemplateIds: [] },
  });
  const child = await response.json();
  const profiles = await (await request.get(origin + '/api/children')).json();
  await request.post(origin + '/api/children/' + child.id + '/days/' + profiles.today + '/one-offs', {
    headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
    data: { points: 10, reason: 'Award' },
  });
  await page.goto(origin + '/children?prizes=' + child.id);
  await expect(page.getByLabel('10 stars', { exact: true })).toBeVisible();
  await page.getByLabel('Prize name', { exact: true }).fill('Choose a movie');
  await page.getByLabel('Stars to spend').fill('7');
  await expect(page.getByText('Balance after redemption')).toContainText('3');
  await page.getByRole('button', { name: 'Redeem', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Choose a movie' })).toBeVisible();
  await expect(page.getByLabel('3 stars', { exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath('prizes.png'), fullPage: true });
  await page.getByRole('button', { name: 'Void redemption' }).click();
  await expect(page.getByText('Voided · Stars returned', { exact: true })).toBeVisible();
  await expect(page.getByLabel('10 stars', { exact: true })).toBeVisible();
});
