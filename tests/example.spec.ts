import { test, expect } from './testLogger';

test('has title', async ({ page }) => {
  console.info('--- Example test start: has title');
  console.info('Action: open Playwright homepage and verify title.');
  await page.goto('https://playwright.dev/');

  // Expect a title "to contain" a substring.
  await expect(page).toHaveTitle(/Playwright/);
  console.info('--- Example test end: has title');
});

test('get started link', async ({ page }) => {
  console.info('--- Example test start: get started link');
  console.info('Action: open Playwright homepage and click Get started link.');
  await page.goto('https://playwright.dev/');

  // Click the get started link.
  await page.getByRole('link', { name: 'Get started' }).click();

  // Expects page to have a heading with the name of Installation.
  await expect(page.getByRole('heading', { name: 'Installation' })).toBeVisible();
  console.info('--- Example test end: get started link');
});
