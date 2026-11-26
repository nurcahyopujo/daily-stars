import { expect, test, type Locator, type Page } from '@playwright/test';
import { seedBrowserDatabase } from './database';

const origin = 'http://127.0.0.1:4174';

test.use({ extraHTTPHeaders: { 'x-daily-stars-test-clock': 'fixed' } });

// The shadcn Select renders a combobox button + listbox popup, not a native
// <select>, so drive it by opening and clicking the option.
async function pick(page: Page, combo: string, option: string) {
  await page.getByRole('combobox', { name: combo }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

// The review period is a segmented control of native radios. Changing it refetches
// and remounts the cards, so wait for the new period's data before touching them;
// otherwise a card opened on the old render comes back closed.
async function selectPeriod(page: Page, label: string) {
  const days = label === 'Last 4 weeks' ? '28' : '7';
  const loaded = page.waitForResponse((response) => response.url().includes(`/activity-review?days=${days}`));
  await page.getByRole('radio', { name: label, exact: true }).check();
  await loaded;
  await expect(page.getByRole('status').filter({ hasText: 'Loading activity review' })).toHaveCount(0);
}

// Each activity is a collapsible <details>; open it before reading its breakdown.
function activityCard(page: Page, text: string) {
  return page.locator('details.activity-review-card').filter({ hasText: text });
}
async function openCard(card: Locator) {
  await card.evaluate((element) => { (element as HTMLDetailsElement).open = true; });
}

async function openDay(page: Page, name: string) {
  await page.goto(origin + '/');
  const child = page.getByRole('listitem').filter({
    has: page.getByRole('heading', { name, exact: true }),
  });
  await child.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

async function openReviewFromDay(page: Page, name: string) {
  await page.getByRole('link', { name: 'Activity review', exact: true }).click();
  await expect(page.getByRole('heading', { name: name + ' · Activity review' })).toBeVisible();
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
  await expect(page.getByText('No activities were scheduled in either period.')).toBeVisible();
  await expect(page.getByText('Current Nov 2 – Nov 8')).toBeVisible();
  await expect(page.getByText('Previous Oct 26 – Nov 1')).toBeVisible();

  // The chart carries the daily stars visually; the accessible figures live in
  // the hidden data table beside it.
  await expect(page.locator('figure.activity-review-chart svg')).toBeVisible();
  const stars = page.getByRole('table', { name: 'Daily stars' });
  await expect(stars.getByRole('row')).toHaveCount(8);
  await expect(stars.getByRole('rowheader', { name: '2026-11-08' })).toHaveCount(1);
  await expect(stars.getByRole('rowheader', { name: '2026-11-09' })).toHaveCount(0);
  await page.screenshot({ path: info.outputPath('activity-review-empty.png'), fullPage: true });

  await selectPeriod(page, 'Last 4 weeks');
  await expect(page.getByRole('radio', { name: 'Last 4 weeks' })).toBeChecked();
  await expect(page.getByText('Current Oct 12 – Nov 8')).toBeVisible();
  await expect(page.getByText('Previous Sep 14 – Oct 11')).toBeVisible();
  await expect(stars.getByRole('row')).toHaveCount(29);
  // The responsive chart replaces the old scrolling table: nothing overflows the
  // 280px phone column.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(280);

  await context.setOffline(true);
  // Offline, so no response arrives; check the radio directly instead of waiting for data.
  await page.getByRole('radio', { name: 'Last 7 days', exact: true }).check();
  await expect(page.getByRole('alert')).toContainText('Couldn’t load the activity review.');
  await page.screenshot({ path: info.outputPath('activity-review-error.png'), fullPage: true });
  await context.setOffline(false);
  await page.getByRole('button', { name: 'Reload review' }).press('Enter');
  await expect(page.getByRole('radio', { name: 'Last 7 days' })).toBeFocused();
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

  const renamed = activityCard(page, morningName + ' · Activity 1 of 2');
  await expect(renamed.getByRole('heading', { name: 'Make the bed', exact: true })).toBeVisible();
  // The collapsed summary carries an at-a-glance figure; the breakdown is hidden
  // until the disclosure is opened.
  await expect(renamed.getByText('3/5 done well')).toBeVisible();
  const current = renamed.getByRole('region', { name: 'Current period' });
  await expect(current).toBeHidden();
  await renamed.locator('summary').click();
  await expect(current.getByText('4 of 5 recorded')).toBeVisible();
  await expect(current.getByText('3 done correctly')).toBeVisible();
  await expect(current.getByText('1 needs improvement')).toBeVisible();
  await expect(current.getByText('1 unrecorded')).toBeVisible();
  const previous = renamed.getByRole('region', { name: 'Previous period' });
  await expect(previous.getByText('1 of 4 recorded')).toBeVisible();
  await expect(previous.getByText('1 done correctly')).toBeVisible();
  await expect(previous.getByText('3 unrecorded')).toBeVisible();

  const duplicate = activityCard(page, morningName + ' · Activity 2 of 2');
  await expect(duplicate.getByRole('heading', { name: 'Make the bed', exact: true })).toBeVisible();
  await openCard(duplicate);
  await expect(duplicate.getByRole('region', { name: 'Current period' }).getByText('0 of 1 recorded')).toBeVisible();
  await expect(duplicate.getByRole('region', { name: 'Previous period' }).getByText('Not scheduled')).toBeVisible();

  const unassigned = activityCard(page, 'Set the alarm');
  await openCard(unassigned);
  await expect(unassigned.getByRole('region', { name: 'Previous period' }).getByText('0 of 4 recorded')).toBeVisible();
  await expect(unassigned.getByRole('region', { name: 'Current period' }).getByText('Not scheduled')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Make the bed today' })).toHaveCount(0);

  await selectPeriod(page, 'Last 4 weeks');
  await openCard(renamed);
  await expect(current.getByText('5 of 9 recorded')).toBeVisible();
  await openCard(duplicate);
  await expect(duplicate.getByRole('region', { name: 'Current period' }).getByText('0 of 2 recorded')).toBeVisible();

  await openReview(page, secondName);
  // Two cards here are both "Make the bed"; the recorded count identifies the routine one.
  const shared = activityCard(page, '1 of 5 recorded');
  await expect(shared.getByRole('heading', { name: 'Make the bed', exact: true })).toBeVisible();
  await openCard(shared);
  const sharedCurrent = shared.getByRole('region', { name: 'Current period' });
  await expect(sharedCurrent.getByText('1 of 5 recorded')).toBeVisible();
  await expect(sharedCurrent.getByText('0 done correctly')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Set the alarm' })).toHaveCount(0);
});

test('parent sees dated routine points, corrected and voided awards, and a reset outcome', async ({ page }, info) => {
  const { name, morningName, routineDate, previousScoreDate } = await seedReviewHistory();
  await openDay(page, name);
  // The activity date is chosen through the shadcn date-picker popover.
  await page.getByRole('button', { name: /Activity date/ }).click();
  await page.getByRole('gridcell', { name: 'Friday, 6 November 2026', exact: true }).click();
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

  await selectPeriod(page, 'Last 4 weeks');
  await expect(cellsOn(previousScoreDate)).toHaveText(['+1', '0', '+1']);

  await page.getByRole('link', { name, exact: true }).click();
  await expect(page.getByRole('button', { name: /Activity date/ })).toHaveAccessibleName(/6 Nov 2026/);
  await oneOff.getByRole('button', { name: 'Edit entry' }).click();
  await pick(page, 'Entry type', 'Deduction');
  await page.getByRole('spinbutton', { name: 'Stars', exact: true }).fill('3');
  await page.getByRole('button', { name: 'Review entry' }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(oneOff.getByText('Deduction', { exact: false })).toBeVisible();

  await openReviewFromDay(page, name);
  await expect(cellsOn(routineDate)).toHaveText(['+2', '-3', '-1']);

  await page.getByRole('link', { name, exact: true }).click();
  await oneOff.getByRole('button', { name: 'Void entry' }).click();
  const voidDialog = page.getByRole('alertdialog', { name: 'Void entry?' });
  await expect(voidDialog).toContainText('This is final.');
  await voidDialog.screenshot({ path: info.outputPath('void-confirmation.png') });
  await voidDialog.getByRole('button', { name: 'Cancel' }).click();
  await expect(oneOff.getByRole('button', { name: 'Void entry' })).toBeFocused();
  await oneOff.getByRole('button', { name: 'Void entry' }).click();
  await voidDialog.getByRole('button', { name: 'Void entry' }).click();
  await expect(oneOff.getByText('Voided', { exact: false })).toBeVisible();
  await openReviewFromDay(page, name);
  await expect(cellsOn(routineDate)).toHaveText(['+2', '0', '+2']);

  await page.getByRole('link', { name, exact: true }).click();
  await routine.getByRole('button', { name: 'Reset', exact: true }).click();
  await expect(routine.getByText('Unrecorded', { exact: true })).toBeVisible();
  await openReviewFromDay(page, name);
  await expect(cellsOn(routineDate)).toHaveText(['0', '0', '0']);
  const changedActivity = activityCard(page, morningName + ' · Activity 1 of 2');
  await openCard(changedActivity);
  const changedCurrent = changedActivity.getByRole('region', { name: 'Current period' });
  await expect(changedCurrent.getByText('3 of 5 recorded')).toBeVisible();
  await expect(changedCurrent.getByText('2 unrecorded')).toBeVisible();
});
