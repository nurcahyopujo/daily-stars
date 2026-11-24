import { expect, test, type APIRequestContext } from '@playwright/test';
import { navigate } from './navigation';

const origin = 'http://127.0.0.1:4174';
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');

async function createPrize(request: APIRequestContext, fields: Record<string, unknown>) {
  const response = await request.post(origin + '/api/prizes', {
    headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
    data: { oneTime: false, link: null, imageUrl: null, ...fields },
  });
  expect(response.status()).toBe(201);
  return response.json();
}

test('parent adds, finds, orders and archives prizes', async ({ page, request }, info) => {
  const tag = crypto.randomUUID().slice(0, 8);
  await page.route('https://images.example.test/**', route => route.fulfill({ body: png, contentType: 'image/png' }));
  await createPrize(request, { name: `Ice cream ${tag}`, cost: 3 });
  await createPrize(request, { name: `Bike ${tag}`, cost: 40, oneTime: true });

  await page.goto(origin + '/');
  await navigate(page, 'Prizes');
  await expect(page.getByRole('heading', { name: 'Prizes', level: 1 })).toBeVisible();
  await page.getByRole('link', { name: 'Add prize' }).first().click();
  await page.getByLabel('Name', { exact: true }).fill(`Lego ${tag}`);
  await page.getByLabel('Cost in stars').fill('25');
  await page.getByText('One-time', { exact: true }).click();
  await page.getByLabel(/Store link/).fill('https://shopee.co.id/LEGO-i.383841102.12976454803');
  await page.getByLabel(/Image address/).fill('https://images.example.test/lego.png');
  await expect(page.getByLabel('Preview').locator('img')).toBeVisible();
  await page.getByRole('button', { name: 'Add prize' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Saved Lego ${tag}.` })).toBeVisible();

  const search = page.getByRole('searchbox', { name: 'Search prizes' });
  await search.fill(tag);
  await expect(page).toHaveURL(new RegExp(`q=${tag}`));
  const cards = page.getByRole('main').getByRole('listitem');
  await expect(cards.getByRole('heading')).toHaveText([`Ice cream ${tag}`, `Lego ${tag}`, `Bike ${tag}`]);
  const lego = cards.filter({ hasText: `Lego ${tag}` });
  await expect(lego.getByText('One-time')).toBeVisible();
  await expect(lego.getByRole('link', { name: /View on Shopee/ })).toHaveAttribute('target', '_blank');
  await expect(lego.locator('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await page.screenshot({ path: info.outputPath('catalog.png'), fullPage: true });

  await page.getByLabel('Sort').selectOption('name-desc');
  await expect(cards.getByRole('heading')).toHaveText([`Lego ${tag}`, `Ice cream ${tag}`, `Bike ${tag}`]);
  await page.getByLabel('Type').selectOption('one-time');
  await expect(cards.getByRole('heading')).toHaveText([`Lego ${tag}`, `Bike ${tag}`]);
  await page.getByLabel('Link').selectOption('with');
  await expect(cards.getByRole('heading')).toHaveText([`Lego ${tag}`]);
  await page.reload();
  await expect(cards.getByRole('heading')).toHaveText([`Lego ${tag}`]);
  await expect(page.getByLabel('Sort')).toHaveValue('name-desc');

  await page.getByRole('link', { name: `Lego ${tag}` }).click();
  await page.getByRole('button', { name: 'Archive prize' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Saved Lego ${tag} · Archived.` })).toBeVisible();
  await expect(page.getByText('No matching prizes')).toBeVisible();
  await page.getByLabel('Status').selectOption('archived');
  await expect(cards.getByRole('heading')).toHaveText([`Lego ${tag}`]);
  await expect(cards.getByText('Archived', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: `Lego ${tag}` }).click();
  await page.getByRole('button', { name: 'Save and restore' }).click();
  await page.getByLabel('Status').selectOption('active');
  await expect(cards.getByRole('heading')).toHaveText([`Lego ${tag}`]);
});

test('rejects a duplicate prize name and keeps the draft', async ({ page, request }) => {
  const name = 'Duplicate ' + crypto.randomUUID().slice(0, 8);
  await createPrize(request, { name, cost: 5 });
  await page.goto(origin + '/prizes/new');
  await page.getByLabel('Name', { exact: true }).fill(name.toUpperCase());
  await page.getByLabel('Cost in stars').fill('5');
  await page.getByRole('button', { name: 'Add prize' }).click();
  await expect(page.getByRole('alert')).toHaveText('Another active prize already has this name. Choose a different name.');
  await expect(page.getByLabel('Name', { exact: true })).toHaveValue(name.toUpperCase());
});

test('parent redeems a one-time prize from the prize list', async ({ page, request }, info) => {
  const tag = crypto.randomUUID().slice(0, 8);
  const child = await (await request.post(origin + '/api/children', {
    headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
    data: { displayName: 'Catalog child ' + tag, initialTemplateIds: [] },
  })).json();
  const { today } = await (await request.get(origin + '/api/children')).json();
  await request.post(`${origin}/api/children/${child.id}/days/${today}/one-offs`, {
    headers: { Origin: origin, 'Idempotency-Key': crypto.randomUUID() },
    data: { points: 10, reason: 'Award' },
  });
  await createPrize(request, { name: `Kite ${tag}`, cost: 4, oneTime: true });
  await createPrize(request, { name: `Castle ${tag}`, cost: 99_000 });

  await page.goto(`${origin}/children/${child.id}/prizes`);
  await expect(page.getByLabel('10 stars', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'From prize list' })).toHaveAttribute('aria-pressed', 'true');
  const castle = page.getByRole('radio', { name: new RegExp(`Castle ${tag}`) });
  await expect(castle).toBeDisabled();
  await expect(page.getByText('Needs 98990 more stars')).toBeVisible();
  await page.getByRole('radio', { name: new RegExp(`Kite ${tag}`) }).check();
  await expect(page.getByText('Balance after redemption')).toContainText('6');
  await page.getByRole('button', { name: 'Redeem', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Kite ${tag}` })).toBeVisible();
  await expect(page.getByLabel('6 stars', { exact: true })).toBeVisible();
  const kite = page.getByRole('radio', { name: new RegExp(`Kite ${tag}`) });
  await expect(kite).toBeDisabled();
  await expect(page.locator('label').filter({ hasText: `Kite ${tag}` })).toContainText('Already redeemed');
  await page.screenshot({ path: info.outputPath('redeem-catalog.png'), fullPage: true });

  await page.getByRole('button', { name: 'Void redemption' }).click();
  await expect(page.getByLabel('10 stars', { exact: true })).toBeVisible();
  await expect(kite).toBeEnabled();

  await page.getByRole('button', { name: 'Something else' }).click();
  await expect(page.getByLabel('Prize name', { exact: true })).toBeVisible();
});
