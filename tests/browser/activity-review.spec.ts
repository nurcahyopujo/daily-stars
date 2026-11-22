import { expect, test, type Page } from '@playwright/test';
import { seedBrowserDatabase } from './database';

const origin = 'http://127.0.0.1:4174';

test.use({ extraHTTPHeaders: { 'x-daily-stars-test-clock': 'fixed' } });

async function openDay(page: Page, name: string) {
  await page.goto(origin + '/children');
  const child = page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
  await child.getByRole('link', { name: 'Open today' }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function openReviewFromDay(page: Page, name: string) {
  await page.getByRole('link', { name: 'Activity review', exact: true }).click();
  await expect(page.getByRole('heading', { name: name + '’s activity review' })).toBeVisible();
}

async function openReview(page: Page, name: string) {
  await openDay(page, name);
  await openReviewFromDay(page, name);
}

test('parent reviews completed household days and switches to four weeks', async ({ page, context }, info) => {
  const id = crypto.randomUUID();
  const name = 'LongReviewNicknameWithoutSpaces' + id.slice(0, 8);
  await seedBrowserDatabase((db) => [
    db.prepare('INSERT INTO children (id, display_name, start_date, revision, created_at) VALUES (?, ?, ?, 1, ?)')
      .bind(id, name, '2026-11-01', '2026-11-01T00:00:00Z'),
  ]);

  await page.setViewportSize({ width: 280, height: 700 });
  await openReview(page, name);
  // Reproduce the wide table text from CI on either operating system.
  await page.addStyleTag({ content: 'table { font-family: Verdana, system-ui; letter-spacing: 1px; }' });
  await expect(page.getByText('No activities were scheduled in either period.')).toBeVisible();
  await expect(page.getByText('Current period: 2026-11-02 to 2026-11-08')).toBeVisible();
  await expect(page.getByText('Previous period: 2026-10-26 to 2026-11-01')).toBeVisible();
  const stars = page.getByRole('table', { name: 'Daily stars' });
  await expect(stars.getByRole('row')).toHaveCount(8);
  await expect(stars.getByRole('rowheader', { name: '2026-11-08' })).toBeVisible();
  await expect(stars.getByRole('rowheader', { name: '2026-11-09' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('activity-review-empty.png'), fullPage: true });

  const period = page.getByRole('combobox', { name: 'Review period', exact: true });
  await period.focus();
  await expect(period).toBeFocused();
  await period.selectOption({ label: 'Last 4 weeks' });
  await expect(page.getByText('Current period: 2026-10-12 to 2026-11-08')).toBeVisible();
  await expect(page.getByText('Previous period: 2026-09-14 to 2026-10-11')).toBeVisible();
  await expect(stars.getByRole('row')).toHaveCount(29);
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(280);

  await context.setOffline(true);
  await period.selectOption({ label: 'Last 7 days' });
  await expect(page.getByRole('alert')).toContainText('Couldn’t load the activity review.');
  await page.screenshot({ path: info.outputPath('activity-review-error.png'), fullPage: true });
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Reload review' }).press('Enter');
  await expect(period).toBeFocused();
  await expect(stars.getByRole('row')).toHaveCount(8);
});

async function seedReviewHistory() {
  const childId = crypto.randomUUID();
  const secondChildId = crypto.randomUUID();
  const morning = '0' + crypto.randomUUID().slice(1);
  const namesake = '1' + crypto.randomUUID().slice(1);
  const evening = crypto.randomUUID();
  const bed = crypto.randomUUID();
  const firstStart = '2026-10-25';
  const oldStart = '2026-10-26';
  const newStart = '2026-11-02';
  const name = 'Review history ' + childId.slice(0, 8);
  const secondName = 'Shared routines ' + secondChildId.slice(0, 8);
  const morningName = 'Morning routine ' + childId.slice(0, 8);

  const routineDate = '2026-11-06';
  const previousScoreDate = '2026-11-01';
  const oldSchedule = [1, 3, 5, 7];
  const workweek = [1, 2, 3, 4, 5];

  await seedBrowserDatabase((db) => {
    const timestamp = firstStart + 'T00:00:00Z';
    const actor = 'report-test@example.test';
    const child = (id: string, label: string) =>
      db.prepare('INSERT INTO children (id, display_name, start_date, revision, created_at) VALUES (?, ?, ?, 1, ?)')
        .bind(id, label, firstStart, timestamp);
    const template = (id: string) =>
      db.prepare('INSERT INTO templates VALUES (?, ?)').bind(id, timestamp);
    const version = (id: string, revision: number, effective: string, label: string, activities: object[]) =>
      db.prepare('INSERT INTO template_versions VALUES (?, ?, ?, ?, 0, ?, ?, ?, ?)')
        .bind(id, revision, effective, label, JSON.stringify(activities), actor, actor, timestamp);
    const assignment = (id: string, revision: number, effective: string, templates: string[]) =>
      db.prepare('INSERT INTO assignment_versions VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(id, revision, effective, JSON.stringify(templates), actor, actor, timestamp);
    const result = (id: string, date: string, outcome: string, points: number) =>
      db.prepare("INSERT INTO score_revisions VALUES (?, ?, ?, 1, ?, ?, '', ?, ?)")
        .bind(id, date, 'activities/' + morning + '/' + bed, points, outcome, actor, timestamp);

    return [
      child(childId, name),
      child(secondChildId, secondName),
      template(morning),
      template(evening),
      template(namesake),
      version(namesake, 1, firstStart, morningName, [
        { id: crypto.randomUUID(), label: 'Make the bed', reward: 1, weekdays: [7] },
      ]),
      version(morning, 1, oldStart, morningName, [
        { id: bed, label: 'Straighten the bed', reward: 1, weekdays: oldSchedule },
      ]),
      version(morning, 2, newStart, morningName, [
        { id: bed, label: 'Make the bed', reward: 2, weekdays: workweek },
      ]),
      version(morning, 3, '2026-11-09', morningName, [
        { id: bed, label: 'Make the bed today', reward: 99, weekdays: [1, 2, 3, 4, 5, 6, 7] },
      ]),
      version(evening, 1, oldStart, 'Evening routine ' + childId.slice(0, 8), [
        { id: crypto.randomUUID(), label: 'Set the alarm', reward: 1, weekdays: oldSchedule },
      ]),
      // The wider window encounters the namesake first.
      assignment(childId, 1, firstStart, [namesake]),
      assignment(childId, 2, oldStart, [morning, evening]),
      assignment(childId, 3, newStart, [morning, namesake]),
      assignment(secondChildId, 1, newStart, [morning, namesake]),
      ...[routineDate, '2026-11-05', '2026-11-04'].map((date) => result(childId, date, 'done_correctly', 2)),
      result(childId, '2026-11-03', 'needs_improvement', 0),
      result(childId, previousScoreDate, 'done_correctly', 1),
      result(secondChildId, routineDate, 'needs_improvement', 0),
    ];
  });
  return { name, secondName, morningName, routineDate, previousScoreDate };
}

test('parent compares recorded outcomes using the assignments, schedules, and activity identities in each period', async ({ page }) => {
  const { name, secondName, morningName } = await seedReviewHistory();
  await openReview(page, name);
  const renamed = page.getByRole('article').filter({ hasText: morningName + ' · Activity 1 of 2' });
  await expect(renamed.getByRole('heading', { name: 'Make the bed', exact: true })).toBeVisible();
  const current = renamed.getByRole('region', { name: 'Current period' });
  await expect(current.getByText('4 of 5 recorded')).toBeVisible();
  await expect(current.getByText('3 done correctly')).toBeVisible();
  await expect(current.getByText('1 needs improvement')).toBeVisible();
  await expect(current.getByText('1 unrecorded')).toBeVisible();
  const previous = renamed.getByRole('region', { name: 'Previous period' });
  await expect(previous.getByText('1 of 4 recorded')).toBeVisible();
  await expect(previous.getByText('1 done correctly')).toBeVisible();
  await expect(previous.getByText('3 unrecorded')).toBeVisible();

  const duplicate = page.getByRole('article').filter({ hasText: morningName + ' · Activity 2 of 2' });
  await expect(duplicate.getByRole('heading', { name: 'Make the bed', exact: true })).toBeVisible();
  await expect(duplicate.getByRole('region', { name: 'Current period' }).getByText('0 of 1 recorded')).toBeVisible();
  await expect(duplicate.getByRole('region', { name: 'Previous period' }).getByText('Not scheduled')).toBeVisible();

  const unassigned = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Set the alarm' }) });
  await expect(unassigned.getByRole('region', { name: 'Previous period' }).getByText('0 of 4 recorded')).toBeVisible();
  await expect(unassigned.getByRole('region', { name: 'Current period' }).getByText('Not scheduled')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Make the bed today' })).toHaveCount(0);

  await page.getByRole('combobox', { name: 'Review period' }).selectOption({ label: 'Last 4 weeks' });
  await expect(current.getByText('5 of 9 recorded')).toBeVisible();
  await expect(duplicate.getByRole('region', { name: 'Current period' }).getByText('0 of 2 recorded')).toBeVisible();

  await openReview(page, secondName);
  const shared = page.getByRole('article').filter({ hasText: '1 of 5 recorded' });
  await expect(shared.getByRole('heading', { name: 'Make the bed', exact: true })).toBeVisible();
  await expect(shared.getByRole('region', { name: 'Current period' }).getByText('0 done correctly')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Set the alarm' })).toHaveCount(0);
});

test('parent sees dated routine points, corrected and voided awards, and a reset outcome', async ({ page }, info) => {
  const { name, morningName, routineDate, previousScoreDate } = await seedReviewHistory();
  await openDay(page, name);
  await page.getByLabel('Activity date', { exact: true }).fill(routineDate);
  const routine = page.getByRole('article').filter({ has: page.getByRole('heading', { name: 'Make the bed', exact: true }) });
  await expect(routine.getByText('Done correctly', { exact: false }).first()).toBeVisible();
  await page.getByRole('button', { name: 'Add stars', exact: true }).click();
  await page.getByRole('spinbutton', { name: 'Stars', exact: true }).fill('5');
  await page.getByLabel('Reason', { exact: true }).fill('Helped carry groceries');
  await page.getByRole('button', { name: 'Review entry' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();

  const oneOff = page.getByRole('article').filter({
    has: page.getByRole('heading', { name: 'Helped carry groceries' }),
  });
  await expect(oneOff.getByText('Award', { exact: false })).toBeVisible();
  await openReviewFromDay(page, name);
  const cellsOn = (date: string) => page.getByRole('table', { name: 'Daily stars' }).getByRole('row')
    .filter({ has: page.getByRole('rowheader', { name: date }) }).getByRole('cell');
  await expect(cellsOn(routineDate)).toHaveText(['+2', '+5', '+7']);
  await page.screenshot({ path: info.outputPath('activity-review.png'), fullPage: true });

  await page.getByRole('combobox', { name: 'Review period' }).selectOption({ label: 'Last 4 weeks' });
  await expect(cellsOn(previousScoreDate)).toHaveText(['+1', '0', '+1']);

  await page.getByRole('link', { name: /Back to day/ }).click();
  await expect(page.getByLabel('Activity date', { exact: true })).toHaveValue(routineDate);
  await oneOff.getByRole('button', { name: 'Edit entry' }).click();
  await page.getByRole('combobox', { name: 'Entry type' }).selectOption({ label: 'Deduction' });
  await page.getByRole('spinbutton', { name: 'Stars', exact: true }).fill('3');
  await page.getByRole('button', { name: 'Review entry' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(oneOff.getByText('Deduction', { exact: false })).toBeVisible();

  await openReviewFromDay(page, name);
  await expect(cellsOn(routineDate)).toHaveText(['+2', '-3', '-1']);

  await page.getByRole('link', { name: /Back to day/ }).click();
  page.once('dialog', (dialog) => dialog.accept());
  await oneOff.getByRole('button', { name: 'Void entry' }).click();
  await expect(oneOff.getByText('Voided', { exact: false })).toBeVisible();
  await openReviewFromDay(page, name);
  await expect(cellsOn(routineDate)).toHaveText(['+2', '0', '+2']);

  await page.getByRole('link', { name: /Back to day/ }).click();
  await routine.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(routine.getByText('Unrecorded', { exact: true })).toBeVisible();
  await openReviewFromDay(page, name);
  await expect(cellsOn(routineDate)).toHaveText(['0', '0', '0']);
  const changedActivity = page.getByRole('article').filter({ hasText: morningName + ' · Activity 1 of 2' });
  const current = changedActivity.getByRole('region', { name: 'Current period' });
  await expect(current.getByText('3 of 5 recorded')).toBeVisible();
  await expect(current.getByText('2 unrecorded')).toBeVisible();
});
