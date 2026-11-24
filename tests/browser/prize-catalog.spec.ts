import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { navigate } from './navigation';

const origin = 'http://127.0.0.1:4174';

// The filters are shadcn Selects: open the combobox, then choose the option.
async function pick(page: Page, combo: string, option: string) {
  await page.getByRole('combobox', { name: combo }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}
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
  // The router quotes a number-like value (q=%22123%22) so it reads back as text.
  await expect(page).toHaveURL(new RegExp(`q=(%22)?${tag}`));
  const cards = page.getByRole('main').getByRole('listitem');
  await expect(cards.getByRole('heading')).toHaveText([`Ice cream ${tag}`, `Lego ${tag}`, `Bike ${tag}`]);
  const lego = cards.filter({ hasText: `Lego ${tag}` });
  await expect(lego.getByText('One-time')).toBeVisible();
  await expect(lego.getByRole('link', { name: /View on Shopee/ })).toHaveAttribute('target', '_blank');
  await expect(lego.locator('img')).toHaveAttribute('referrerpolicy', 'no-referrer');
  await page.screenshot({ path: info.outputPath('catalog.png'), fullPage: true });

  await pick(page, 'Sort', 'Name: Z–A');
  await expect(cards.getByRole('heading')).toHaveText([`Lego ${tag}`, `Ice cream ${tag}`, `Bike ${tag}`]);
  await pick(page, 'Type', 'One-time');
  await expect(cards.getByRole('heading')).toHaveText([`Lego ${tag}`, `Bike ${tag}`]);
  await pick(page, 'Link', 'Has link');
  await expect(cards.getByRole('heading')).toHaveText([`Lego ${tag}`]);
  await page.reload();
  await expect(cards.getByRole('heading')).toHaveText([`Lego ${tag}`]);
  await expect(page.getByRole('combobox', { name: 'Sort' })).toHaveText('Name: Z–A');

  await page.getByRole('link', { name: `Lego ${tag}` }).click();
  await page.getByRole('button', { name: 'Archive prize' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Saved Lego ${tag} · Archived.` })).toBeVisible();
  await expect(page.getByText('No matching prizes')).toBeVisible();
  await pick(page, 'Status', 'Archived');
  await expect(cards.getByRole('heading')).toHaveText([`Lego ${tag}`]);
  await expect(cards.getByText('Archived', { exact: true })).toBeVisible();

  await page.getByRole('link', { name: `Lego ${tag}` }).click();
  await page.getByRole('button', { name: 'Save and restore' }).click();
  await pick(page, 'Status', 'Active');
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
  // More than one page of prizes, so the picker offers search, a filter, and "Show more".
  for (let index = 1; index <= 10; index++) await createPrize(request, { name: `Filler ${index} ${tag}`, cost: 1000 + index });

  await page.goto(`${origin}/children/${child.id}/prizes`);
  await expect(page.getByLabel('10 stars', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'From prize list' })).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByRole('radio')).toHaveCount(10);
  await page.getByRole('searchbox', { name: 'Search prizes' }).fill(tag);
  await expect(page.getByText('Showing 10 of 12')).toBeVisible();
  const castle = page.getByRole('radio', { name: new RegExp(`Castle ${tag}`) });
  await expect(castle).toHaveCount(0);
  await page.getByRole('button', { name: 'Show 2 more' }).click();
  await expect(castle).toBeDisabled();
  await expect(page.getByText('Needs 98990 more stars')).toBeVisible();

  await page.getByRole('combobox', { name: 'Show' }).click();
  await page.getByRole('option', { name: 'Can redeem now', exact: true }).click();
  await expect(page.getByRole('radio')).toHaveCount(1);
  await page.getByRole('radio', { name: new RegExp(`Kite ${tag}`) }).check();
  await expect(page.getByText('Balance after redemption')).toContainText('6');
  await expect(page.getByRole('button', { name: 'Redeem', exact: true })).toBeEnabled();
  await page.screenshot({ path: info.outputPath('redeem-search.png'), fullPage: true });
  await page.getByRole('button', { name: 'Redeem', exact: true }).click();
  await expect(page.getByRole('heading', { name: `Kite ${tag}` })).toBeVisible();
  await expect(page.getByLabel('6 stars', { exact: true })).toBeVisible();
  await expect(page.getByText('No matching prizes. Try another search or show all prizes.')).toBeVisible();

  await page.getByRole('combobox', { name: 'Show' }).click();
  await page.getByRole('option', { name: 'All prizes', exact: true }).click();
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
