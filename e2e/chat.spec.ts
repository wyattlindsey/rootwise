import { expect, test } from '@playwright/test';

/**
 * Browser coverage of the flow that matters: ask a question, watch tools run,
 * read the answer, inspect the evidence.
 *
 * The app runs in demo mode here -- scripted model, fixture upstreams -- so
 * these are deterministic and cost nothing. The MCP server is still real and
 * still does its real mapping work, so the tool output being asserted is
 * genuine.
 */

test('answers a question and shows the tools it used', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'rootwise' })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Demo mode');

  await page.getByLabel('Ask about a plant').fill('Can I plant tomatoes next to potatoes?');
  await page.getByRole('button', { name: 'Ask' }).click();

  const tools = page.getByRole('region', { name: 'Tools used' });
  await expect(tools).toBeVisible({ timeout: 30_000 });
  await expect(tools.getByText('companion_check')).toBeVisible();
  await expect(tools.getByText('planting_window')).toBeVisible();

  await expect(page.getByText(/Solanaceae/)).toBeVisible({ timeout: 30_000 });
});

test('refuses to invent data no source publishes', async ({ page }) => {
  await page.goto('/');

  await page.getByLabel('Ask about a plant').fill('When should I start tomatoes?');
  await page.getByRole('button', { name: 'Ask' }).click();

  // The thesis of the whole project: it says what it does not know.
  await expect(page.getByText(/days-to-maturity/)).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/would be a guess/)).toBeVisible();
});

test('shows the raw tool result when a call is expanded', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /tomatoes next to potatoes/i }).click();

  const companion = page
    .getByRole('region', { name: 'Tools used' })
    .locator('div')
    .filter({ hasText: 'companion_check' })
    .first();
  await expect(companion).toBeVisible({ timeout: 30_000 });

  await companion.getByRole('button').click();

  await expect(companion.getByText(/"verdict"/)).toBeVisible();
  await expect(companion.getByText(/shared-family/)).toBeVisible();
});

test('credits its sources with licences', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /tomatoes next to potatoes/i }).click();

  const sources = page.getByRole('region', { name: 'Sources' });
  await expect(sources).toBeVisible({ timeout: 30_000 });
  await expect(sources.getByRole('link', { name: /Perenual/ })).toBeVisible();
});

test('surfaces caveats rather than burying them', async ({ page }) => {
  await page.goto('/');

  await page.getByRole('button', { name: /tomatoes next to potatoes/i }).click();

  const caveats = page.getByRole('region', { name: 'Caveats' });
  await expect(caveats).toBeVisible({ timeout: 30_000 });
  await expect(caveats).toContainText(/9 km grid|ERA5/);
});

test('lets a visitor set a location for timing answers', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByText('not set — timing answers need one')).toBeVisible();

  await page.getByLabel('Latitude').fill('44.98');
  await page.getByLabel('Longitude').fill('-93.27');

  await expect(page.getByText('44.98, -93.27')).toBeVisible();
});
