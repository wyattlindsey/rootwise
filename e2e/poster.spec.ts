import { expect, test } from '@playwright/test';

/**
 * Not a test so much as an asset build: captures the finished conversation for
 * the README poster and the portfolio hub card. Run with
 * `npx playwright test e2e/poster.spec.ts`.
 */
test('capture poster', async ({ page }) => {
  await page.setViewportSize({ width: 1000, height: 1700 });
  await page.goto('/');

  await page.getByRole('button', { name: /tomatoes next to potatoes/i }).click();
  await expect(page.getByRole('region', { name: 'Sources' })).toBeVisible({ timeout: 30_000 });

  // Open the companion_check result so the poster shows real tool output.
  const companion = page
    .getByRole('region', { name: 'Tools used' })
    .locator('div')
    .filter({ hasText: 'companion_check' })
    .first();
  await companion.getByRole('button').click();
  await expect(companion.getByText(/"verdict"/)).toBeVisible();

  // The transcript scrolls inside its own container, so a full-page capture
  // would cut off the sources. The tall viewport holds the whole exchange.
  await page.screenshot({ path: 'public/poster/rootwise.png' });
});
