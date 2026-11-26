import { expect, test } from '@playwright/test';
import type { Child } from '../../shared/profiles';

const origin = 'http://127.0.0.1:4174';
const morning = '33333333-3333-4333-8333-333333333333';

test('pauses a routine from the child’s assignments, lists it, and cancels it against real local D1', async ({ page, request }, testInfo) => {
  const name = `Pause ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  const created = await request.post(`${origin}/api/children`, {
    headers: { Origin: origin, 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() },
    data: { displayName: name, initialTemplateIds: [morning] },
  });
  expect(created.status()).toBe(201);
  const child = await created.json() as Child;

  await page.goto(`${origin}/children/${child.id}/assignments`);
  const pauses = page.getByRole('region', { name: 'Pauses' });
  await expect(pauses.getByText('No pauses scheduled.')).toBeVisible();
  await pauses.getByRole('link', { name: 'Pause Morning routine' }).click();

  await expect(page).toHaveURL(new RegExp(`/pauses\\?childId=${child.id}&templateId=${morning}`));
  await expect(page.getByRole('checkbox', { name: `${name} · Morning routine` })).toBeChecked();
  await page.getByRole('textbox', { name: 'Reason (optional)' }).fill('Holiday');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('pause-routines.png'), fullPage: true });
  await page.getByRole('button', { name: 'Pause 1 routine' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toContainText('1 routine paused');

  await page.goto(`${origin}/children/${child.id}/assignments`);
  const item = pauses.getByRole('list', { name: 'Scheduled pauses' }).getByRole('listitem').filter({ hasText: 'Morning routine' });
  await expect(item).toContainText('Holiday');
  await page.screenshot({ path: testInfo.outputPath('child-pauses.png'), fullPage: true });
  await item.getByRole('button', { name: 'Cancel Morning routine pause' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toContainText('Morning routine pause cancelled');
  await expect(pauses.getByText('No pauses scheduled.')).toBeVisible();
});
