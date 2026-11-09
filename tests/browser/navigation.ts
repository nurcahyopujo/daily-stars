import type { Page } from '@playwright/test';

export async function navigate(page: Page, destination: 'Home' | 'Manage children' | 'Profile') {
  await page.getByRole('button', { name: 'Main menu', exact: true }).click();
  await page.getByRole('navigation', { name: 'Main menu', exact: true })
    .getByRole('link', { name: destination, exact: true }).click();
}
