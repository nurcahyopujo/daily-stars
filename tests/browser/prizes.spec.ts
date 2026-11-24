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
  // A prize list entry exists, so the redeem form opens on the list; this flow names a prize instead.
  await request.post(origin + '/api/prizes', {
    headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
    data: { name: 'Listed prize ' + crypto.randomUUID(), cost: 1, oneTime: false },
  });
  await page.goto(origin + '/');
  const card = page.getByRole('listitem').filter({ has: page.getByRole('heading', { name: child.displayName, exact: true }) });
  await expect(card.getByRole('link', { name: 'Prizes' })).toHaveCount(0);
  await card.getByRole('link', { name: child.displayName, exact: true }).click();
  await page.getByRole('link', { name: 'Prizes', exact: true }).click();
  await expect(page.getByLabel('10 stars', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Something else' }).click();
  await page.getByLabel('Prize name', { exact: true }).fill('Choose a movie');
  await page.getByLabel('Stars to spend').fill('11');
  await expect(page.getByRole('alert')).toHaveText('Stars to spend exceed the available balance.');
  await expect(page.getByRole('button', { name: 'Redeem', exact: true })).toBeDisabled();
  await page.screenshot({ path: info.outputPath('over-balance.png'), fullPage: true });
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
