import { navigate } from './navigation';
import { expect, test } from '@playwright/test';
import type { TemplateDetail } from '../../shared/profiles';

test('edits a shared routine and recovers a lost response using the original action', async ({ page }, testInfo) => {
  const today = '2026-11-09';
  const tomorrow = '2026-11-10';
  const template: TemplateDetail = { id: 'morning', affectedChildren: ['Sunny', 'Robin'], pending: null,
    current: { name: 'Morning routine', revision: 1, effectiveDate: today, retired: false,
      activities: [{ id: 'first', label: 'Make the bed', reward: 2 }, { id: 'second', label: 'Read', reward: 1 }] } };
  await page.route('**/api/me', route => route.fulfill({ json: { email: 'parent@example.test', today, timezone: 'Asia/Jakarta' } }));
  await page.route('**/api/children?includeArchived=true', route => route.fulfill({ json: { today, children: [] } }));
  await page.route('**/api/templates', route => route.fulfill({ json: { today, templates: [template] } }));
  const keys: string[] = [];
  await page.route('**/api/templates/morning', route => {
    const request = route.request();
    if (request.method() === 'GET') return route.fulfill({ json: { today, ...template } });
    keys.push(request.headers()['idempotency-key']);
    expect(request.postDataJSON()).toMatchObject({ expectedRevision: 1, name: 'Morning routine',
      activities: [{ id: 'second', rewardPoints: 1 }, { id: 'first', rewardPoints: 3 }] });
    if (keys.length === 1) {
      template.pending = { ...template.current!, revision: 2, effectiveDate: tomorrow };
      return route.abort('failed');
    }
    return route.fulfill({ json: { id: 'morning', revision: 2, effectiveDate: tomorrow } });
  });

  await page.goto('/');
  await expect(page.getByRole('region', { name: 'Children', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create template' })).toHaveCount(0);
  await navigate(page, 'Activity templates');
  await expect(page).toHaveURL('/templates');
  await expect(page.getByRole('region', { name: 'Children', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Edit Morning routine, Make the bed' }).click();
  const editor = page.getByRole('dialog', { name: 'Template details' });
  await expect(editor.getByText('Affected children on 2026-11-10: Sunny, Robin')).toBeVisible();
  await editor.getByRole('button', { name: 'Make the bed' }).click();
  await editor.getByRole('spinbutton', { name: 'Reward (stars)' }).fill('3');
  await editor.getByRole('button', { name: 'Move down' }).click();
  await expect(editor.getByRole('button', { name: 'Make the bed' })).toHaveAttribute('aria-expanded', 'true');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('routine-editor.png'), fullPage: true });
  await editor.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('alert')).toContainText('Save not confirmed');
  await page.goBack();
  await expect(page).toHaveURL('/');
  await expect(page.getByRole('alert')).toContainText('Save not confirmed');
  await page.getByRole('button', { name: 'Check / retry' }).click();
  await expect(page.getByRole('region', { name: 'Children', exact: true })).toBeVisible();
  await navigate(page, 'Activity templates');
  await expect(page.getByRole('status').filter({ hasText: 'Saved' })).toContainText('Effective 2026-11-10');
  expect(keys).toEqual([keys[0], keys[0]]);
});

test('creates a template and assigns it to an existing child through local D1', async ({ page }, testInfo) => {
  const suffix = crypto.randomUUID().slice(0, 8);
  const child = `Assignment child ${suffix}`;
  const template = `Evening routine ${suffix}`;
  await page.goto('http://127.0.0.1:4174/');
  await page.getByRole('button', { name: 'Add child', exact: true }).click();
  await page.getByRole('textbox', { name: 'Nickname', exact: true }).fill(child);
  await page.getByRole('button', { name: 'Create child', exact: true }).click();
  await expect(page.getByRole('heading', { name: child, exact: true })).toBeVisible();

  await navigate(page, 'Activity templates');
  await page.reload();
  await page.getByRole('button', { name: 'Create template', exact: true }).click();
  const editor = page.getByRole('dialog', { name: 'Create template' });
  await expect(editor).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(editor).toBeHidden();
  await expect(page.getByRole('button', { name: 'Create template', exact: true })).toBeFocused();
  await page.getByRole('button', { name: 'Create template', exact: true }).click();
  await editor.getByRole('textbox', { name: 'Template name' }).fill(template);
  const activity = 'Read a chapter and put the book back on the shelf';
  await editor.getByRole('textbox', { name: 'Activity label' }).fill(activity);
  await editor.getByRole('checkbox', { name: 'Sun' }).uncheck();
  await editor.getByRole('button', { name: 'Save template' }).click();
  await expect(page.getByRole('button', { name: `Edit ${template}, ${activity}` })).toBeVisible();

  // Assignments live on the child's own detail page now, as an inline editor (no dialog).
  await navigate(page, 'Home');
  await page.getByRole('link', { name: child, exact: true }).click();
  await page.getByRole('link', { name: 'Assignments', exact: true }).click();
  await expect(page).toHaveURL(/\/children\/.+\/assignments$/);
  await expect(page.getByRole('heading', { name: child + ' · Assignments', exact: true })).toBeVisible();

  await expect(page.getByRole('checkbox', { name: template })).toHaveAccessibleDescription(activity);
  await page.getByRole('checkbox', { name: template }).check();
  await page.getByRole('button', { name: 'Save assignments' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved Assignments' })).toContainText('Effective');
  await expect(page.locator('.assign-node.is-tomorrow')).toContainText(template);
  await expect(page.locator('.assign-node.is-today')).toContainText('No templates');

  const startToday = page.getByRole('checkbox', { name: /Start new templates today/ });
  await startToday.check();
  await page.getByRole('checkbox', { name: template }).check();
  await startToday.uncheck();
  await startToday.check();
  await expect(page.getByRole('checkbox', { name: template })).toBeChecked();
  await page.screenshot({ path: testInfo.outputPath('assignments-start-today.png'), fullPage: true });
  await page.getByRole('button', { name: 'Save assignments' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Saved Assignments' })).toContainText('Effective');
  await expect(page.locator('.assign-node.is-today')).toContainText(template);
  await expect(page.locator('.assign-node.is-tomorrow')).toContainText(template);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath('assignments.png'), fullPage: true });

  await navigate(page, 'Activity templates');
  const edit = page.getByRole('button', { name: `Edit ${template}, ${activity}` });
  await edit.click();
  const detail = page.getByRole('dialog', { name: 'Template details' });
  await expect(detail.getByText(new RegExp(`Affected children.*${child}`))).toBeVisible();
  await detail.getByRole('button', { name: activity }).click();
  await detail.getByRole('button', { name: 'Remove activity' }).click();
  await expect(detail.getByRole('button', { name: 'Save template' })).toBeDisabled();
  await detail.getByRole('button', { name: 'Retire template' }).click();
  await detail.getByRole('button', { name: 'Confirm retirement' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Saved ${template}` })).toContainText('Effective');
  await edit.click();
  await detail.getByRole('button', { name: 'Cancel scheduled retirement' }).click();
  await expect(page.getByRole('status').filter({ hasText: `Saved ${template}` })).toContainText('Effective');
  await edit.click();
  await expect(detail.getByRole('button', { name: activity })).toBeVisible();
});
