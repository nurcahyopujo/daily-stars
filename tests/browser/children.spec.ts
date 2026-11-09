import { navigate } from './navigation';
import { expect, test, type Page } from '@playwright/test';
import type { Child, TemplateSummary } from '../../shared/profiles';

const today = '2026-11-09';
const currentChild: Child = { id: 'child-a', displayName: 'Robin', startDate: '2026-11-01', archiveEffectiveDate: null, revision: 1 };
const template = (id: string, name: string): TemplateSummary => ({ id, current: { name, revision: 1, effectiveDate: today, retired: false }, pending: null });

async function fixture(page: Page, options: { children?: Child[]; loseResponse?: boolean; stale?: boolean; failRead?: boolean; challengeWrite?: boolean } = {}) {
  let children = options.children ?? [];
  let loseResponse = options.loseResponse ?? false;
  let stale = options.stale ?? false;
  let failRead = options.failRead ?? false;
  let challengeWrite = options.challengeWrite ?? false;
  const mutations: { key: string; body: Record<string, unknown> }[] = [];
  const receipts = new Map<string, Child>();
  await page.route('**/api/me', (route) => route.fulfill({ json: { email: 'parent@example.test', today, timezone: 'Asia/Jakarta' } }));
  await page.route('**/api/templates', (route) => route.fulfill({ json: {
    today, templates: [template('morning', 'Morning routine'), template('evening', 'Evening routine')],
  } }));
  await page.route('**/api/children**', async (route) => {
    const request = route.request();
    if (request.method() === 'GET') {
      if (failRead) { failRead = false; return route.fulfill({ status: 503, json: { error: { code: 'UNAVAILABLE' } } }); }
      return route.fulfill({ json: { today, children } });
    }
    const key = request.headers()['idempotency-key'];
    const body = request.postDataJSON();
    mutations.push({ key, body });
    if (challengeWrite) {
      challengeWrite = false;
      return route.fulfill({ status: 401, json: { error: { code: 'SIGN_IN_REQUIRED' } } });
    }
    if (stale) {
      stale = false;
      children = [{ ...currentChild, displayName: 'Robin updated by another parent', revision: 2 }];
      return route.fulfill({ status: 409, json: { error: { code: 'STALE_EDIT', message: 'Changed', current: children[0] } } });
    }
    const replay = receipts.get(key);
    if (replay) return route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: replay });
    if (request.method() === 'POST') {
      const child: Child = { id: `new-child-${receipts.size}`, displayName: body.displayName, startDate: today, archiveEffectiveDate: null, revision: 1 };
      children = [...children, child];
      receipts.set(key, child);
      if (loseResponse) { loseResponse = false; return route.abort('failed'); }
      return route.fulfill({ status: 201, json: child });
    }
    const child = children.find((item) => request.url().endsWith(`/${item.id}`))!;
    const updated = { ...child, displayName: body.displayName ?? child.displayName, revision: child.revision + 1,
      archiveEffectiveDate: body.archive ? (child.archiveEffectiveDate ?? '2026-11-10') : child.archiveEffectiveDate };
    children = children.map((item) => item.id === child.id ? updated : item);
    receipts.set(key, updated);
    return route.fulfill({ json: updated });
  });
  return { mutations, getChildren: () => children };
}

test('hamburger menu switches between the Home hero, children and the sign-in Profile', async ({ page }, testInfo) => {
  await fixture(page, { children: [currentChild] });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Small steps. Bright days.' })).toBeVisible();
  await expect(page.getByText('A place for your family’s routines, daily activities, and points.', { exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Profile', exact: true })).toHaveCount(0);
  await expect(page.getByRole('contentinfo')).toHaveText('Every effort counts.');
  const burger = page.getByRole('button', { name: 'Main menu', exact: true });
  const navigation = page.getByRole('navigation', { name: 'Main menu', exact: true });
  await expect(navigation).not.toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('home.png'), fullPage: true });
  await burger.focus();
  await page.keyboard.press('Enter');
  await expect(navigation).toBeVisible();
  await expect(navigation.getByRole('link')).toHaveText(['Home', 'Manage children', 'Profile']);
  await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toHaveAttribute('aria-current', 'page');
  await page.screenshot({ path: testInfo.outputPath('hamburger-menu.png'), fullPage: true });
  await navigation.getByRole('link', { name: 'Home', exact: true }).focus();
  await expect(navigation.getByRole('link', { name: 'Home', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(navigation).not.toBeVisible();
  await expect(burger).toBeFocused();
  await burger.click();
  await page.getByText('Daily Stars', { exact: true }).click();
  await expect(navigation).not.toBeVisible();
  await navigate(page, 'Profile');
  await expect(navigation).not.toBeVisible();
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toHaveText('Every effort counts.');
  await expect(page.getByRole('heading', { name: 'Small steps. Bright days.' })).toHaveCount(0);
  await expect(page.getByText('A place for your family’s routines, daily activities, and points.', { exact: true })).toHaveCount(0);
  await expect(page.getByText('parent@example.test', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Sign out', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Home', exact: true })).toHaveCount(0);
  await navigate(page, 'Manage children');
  await expect(page.getByRole('heading', { name: 'Manage children', exact: true })).toBeVisible();
  await expect(page.getByRole('contentinfo')).toHaveText('Every effort counts.');
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toHaveCount(0);
  await navigate(page, 'Home');
  await expect(page.getByRole('heading', { name: 'Small steps. Bright days.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('direct page URLs, refresh and browser history stay in sync with the menu', async ({ page }) => {
  await fixture(page, { children: [currentChild] });
  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Manage children', exact: true })).toHaveCount(0);
  await page.reload();
  await expect(page).toHaveURL('/profile');
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();

  await navigate(page, 'Manage children');
  await expect(page).toHaveURL('/children');
  await expect(page.getByRole('button', { name: 'Manage Robin' })).toBeVisible();
  await page.reload();
  await expect(page).toHaveURL('/children');
  await expect(page.getByRole('button', { name: 'Manage Robin' })).toBeVisible();
  await navigate(page, 'Home');
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('heading', { name: 'Small steps. Bright days.' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/children');
  await expect(page.getByRole('button', { name: 'Manage Robin' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/profile');
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL('/children');
  await expect(page.getByRole('button', { name: 'Manage Robin' })).toBeVisible();

  await page.goto('/home');
  await expect(page.getByRole('heading', { name: 'Small steps. Bright days.' })).toBeVisible();
  await page.goto('/profile/');
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
  await page.goto('/missing-page');
  await expect(page.getByRole('heading', { name: 'Page not found', exact: true })).toBeVisible();
  await navigate(page, 'Home');
  await expect(page).toHaveURL('/');
});

test('browser Back preserves an unconfirmed action until recovery completes', async ({ page }) => {
  const api = await fixture(page, { loseResponse: true });
  await page.goto('/profile');
  await navigate(page, 'Manage children');
  await page.getByRole('button', { name: 'Add child', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill('Nova');
  await page.getByRole('button', { name: 'Create child', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Save not confirmed' })).toBeVisible();
  await page.goBack();
  await expect(page).toHaveURL('/profile');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Save not confirmed' })).toBeVisible();
  await page.getByRole('button', { name: 'Check / retry' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'You’re signed in' })).toBeVisible();
  expect(api.mutations).toHaveLength(2);
  expect(api.mutations[1]).toEqual(api.mutations[0]);
  expect(api.getChildren()).toHaveLength(1);
  await navigate(page, 'Manage children');
  await expect(page.getByRole('heading', { name: 'Nova', exact: true })).toBeVisible();
});

test('creates with ordered initial templates, renames, and schedules archive from Settings', async ({ page }, testInfo) => {
  const api = await fixture(page);
  await page.goto('/');
  await navigate(page, 'Manage children');
  await expect(page.getByText('No active children. Add a child to get started.')).toBeVisible();
  await page.getByRole('tab', { name: 'Archived (0)', exact: true }).click();
  await expect(page.getByText('No archived children.', { exact: true })).toBeVisible();
  await expect(page.getByText('No active children. Add a child to get started.')).not.toBeVisible();
  await page.getByRole('button', { name: 'Add child', exact: true }).click();
  await expect(page.getByRole('textbox', { name: 'Nickname', exact: true })).toBeFocused();
  await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill('  Nova  ');
  await page.getByLabel('Morning routine', { exact: true }).check();
  await page.getByLabel('Evening routine', { exact: true }).check();
  await page.getByRole('button', { name: 'Move template 2 up' }).click();
  await page.getByRole('button', { name: 'Create child', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toContainText('Saved Nova. Starts at 0 points.');
  expect(api.mutations[0].body).toEqual({ displayName: 'Nova', initialTemplateIds: ['evening', 'morning'] });
  await expect(page.getByRole('tab', { name: 'Active (1)', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('button', { name: 'Add child', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Manage Nova' }).click();
  await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill('Nova’s new nickname');
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('heading', { name: 'Nova’s new nickname', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Manage Nova’s new nickname' }).click();
  await page.getByRole('checkbox', { name: /Archive from 2026-11-10/ }).check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toContainText('Archives from 2026-11-10. History preserved.');
  expect(api.getChildren()[0]).toMatchObject({ id: 'new-child-0', displayName: 'Nova’s new nickname', revision: 3, archiveEffectiveDate: '2026-11-10' });
  expect(api.mutations[2].body).toEqual({ expectedRevision: 2, archive: true });
  await page.screenshot({ path: testInfo.outputPath('profiles.png'), fullPage: true });
});

test('separates child management from Home and uses keyboard-accessible add/edit modals', async ({ page }, testInfo) => {
  const api = await fixture(page, { children: [currentChild] });
  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Home', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Manage children', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Add child', exact: true })).toHaveCount(0);
  await navigate(page, 'Manage children');
  await page.getByRole('button', { name: 'Add child', exact: true }).click();
  const modal = page.getByRole('dialog', { name: 'Add child', exact: true });
  await expect(modal).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Nickname', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
  for (let index = 0; index < 8; index++) {
    await page.keyboard.press('Tab');
    // Native dialogs may let Tab visit browser chrome, but never background page controls.
    expect(await page.evaluate(() => document.activeElement === document.body
      || document.querySelector('dialog')?.contains(document.activeElement))).toBe(true);
  }
  await page.getByRole('textbox', { name: 'Nickname', exact: true }).focus();
  await page.screenshot({ path: testInfo.outputPath('add-child-modal.png'), fullPage: true });
  await page.keyboard.press('Escape');
  await expect(modal).not.toBeVisible();
  await expect(page.getByRole('button', { name: 'Add child', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Manage Robin' }).click();
  await expect(page.getByRole('dialog', { name: 'Manage Robin', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill('Robin with a very long nickname that wraps on a small phone');
  await page.screenshot({ path: testInfo.outputPath('edit-child-modal.png'), fullPage: true });
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Manage Robin' })).toBeFocused();
  expect(api.mutations).toHaveLength(0);
  await navigate(page, 'Home');
  await expect(page.getByRole('heading', { name: 'Manage children', exact: true })).toHaveCount(0);
});

test('recovers a lost response with the same action and intent, including after resume', async ({ page }) => {
  const api = await fixture(page, { loseResponse: true });
  await page.goto('/');
  await navigate(page, 'Manage children');
  await page.getByRole('button', { name: 'Add child', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill('Nova');
  await page.getByRole('button', { name: 'Create child', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Save not confirmed' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Nickname', exact: true })).toBeDisabled();
  await expect(page.locator('.child-profiles-heading button')).toBeDisabled();
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
  await expect(page.getByText('parent@example.test')).toHaveCount(0);
  await page.evaluate(() => dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })));
  await expect(page.getByRole('heading', { name: 'Save not confirmed' })).toBeVisible();
  await page.getByRole('button', { name: 'Check / retry' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toContainText('Saved Nova.');
  expect(api.mutations).toHaveLength(2);
  expect(api.mutations[1]).toEqual(api.mutations[0]);
  expect(api.getChildren()).toHaveLength(1);
  await expect(page.getByRole('heading', { name: 'Nova', exact: true })).toBeVisible();
});

for (const choice of ['Keep current', 'Apply my change']) {
  test(`compares stale results and supports ${choice}`, async ({ page }, testInfo) => {
    const api = await fixture(page, { children: [currentChild], stale: true });
    await page.goto('/');
  await navigate(page, 'Manage children');
    await page.getByRole('button', { name: 'Manage Robin' }).click();
    await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill('My attempted nickname');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Current: Robin updated by another parent · revision 2 · not archived.')).toBeVisible();
    await expect(page.getByText('Your change: My attempted nickname.')).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath('stale-edit.png'), fullPage: true });
    await page.getByRole('button', { name: choice, exact: true }).click();
    if (choice === 'Apply my change') {
      await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toContainText('Saved My attempted nickname.');
      expect(api.mutations[1].body.expectedRevision).toBe(2);
      expect(api.mutations[1].key).not.toBe(api.mutations[0].key);
    } else {
      await expect(page.getByRole('textbox', { name: 'Nickname', exact: true })).toHaveValue('Robin updated by another parent');
      await expect(page.getByRole('textbox', { name: 'Nickname', exact: true })).toBeFocused();
      expect(api.mutations).toHaveLength(1);
    }
  });
}

test('shows archived profiles, supports long names, and allows keyboard cancellation', async ({ page }, testInfo) => {
  const longName = 'A very long nickname with spaces and a bright star at the end';
  await fixture(page, { children: [
    { ...currentChild, displayName: longName },
    { ...currentChild, id: 'archived-child', displayName: 'Past child', archiveEffectiveDate: '2026-11-08' },
  ] });
  await page.goto('/');
  await navigate(page, 'Manage children');
  await expect(page.getByRole('tab', { name: 'Active (1)', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: longName, exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Manage Past child' })).toHaveCount(0);
  await page.getByRole('tab', { name: 'Active (1)', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: 'Archived (1)', exact: true })).toBeFocused();
  await expect(page.getByRole('tab', { name: 'Archived (1)', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('heading', { name: longName, exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Manage Past child' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: 'Nickname', exact: true })).toBeFocused();
  await expect(page.getByRole('checkbox', { name: /Archive from/ })).toHaveCount(0);
  await page.getByRole('button', { name: 'Cancel', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: 'Manage Past child' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('archived-long-name.png'), fullPage: true });
  await page.getByRole('tab', { name: 'Archived (1)', exact: true }).focus();
  await page.keyboard.press('Home');
  await expect(page.getByRole('tab', { name: 'Active (1)', exact: true })).toBeFocused();
  await expect(page.getByRole('heading', { name: longName, exact: true })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('active-long-name.png'), fullPage: true });
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: 'Archived (1)', exact: true })).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: 'Active (1)', exact: true })).toBeFocused();
});

test('offers read-error recovery and keeps an unconfirmed action through session rechecking', async ({ page }) => {
  const api = await fixture(page, { failRead: true, challengeWrite: true });
  await page.goto('/');
  await navigate(page, 'Manage children');
  await expect(page.getByText('Couldn’t load child profiles. Check your connection and try again.')).toBeVisible();
  await page.getByRole('button', { name: 'Reload profiles' }).click();
  await page.getByRole('button', { name: 'Add child', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill('Nova');
  await page.getByRole('button', { name: 'Create child', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to continue' })).toBeVisible();
  await page.getByRole('button', { name: 'Check access' }).click();
  await expect(page.getByRole('button', { name: 'Check / retry' })).toBeVisible();
  await page.getByRole('button', { name: 'Check / retry' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toContainText('Saved Nova.');
  expect(api.mutations[1]).toEqual(api.mutations[0]);
});

test('local development saves profiles to real local D1 and persists them across reloads', async ({ page, request }, testInfo) => {
  const name = `Local ${testInfo.project.name} ${crypto.randomUUID().slice(0, 8)}`;
  await page.goto('http://127.0.0.1:4174/');
  await navigate(page, 'Manage children');
  await page.getByRole('button', { name: 'Add child', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill(name);
  await page.getByLabel('Morning routine', { exact: true }).check();
  await page.getByRole('button', { name: 'Create child', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toContainText(`Saved ${name}.`);
  await page.reload();
  await navigate(page, 'Manage children');
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
  const list = await request.get('http://127.0.0.1:4174/api/children?includeArchived=true');
  const child = (await list.json()).children.find((item: Child) => item.displayName === name);
  expect(child.revision).toBe(1);
  await page.getByRole('button', { name: `Manage ${name}` }).click();
  await page.getByRole('checkbox', { name: /Archive from/ }).check();
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toContainText('History preserved.');
});
