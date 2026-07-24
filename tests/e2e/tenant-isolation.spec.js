import { test, expect } from '@playwright/test';
import { mockApi, SLUG } from './helpers.js';

// Fase 3, item 2: the isolation guarantee. An unknown slug used to fall through
// to DEFAULT_RESTAURANT_SLUG and serve the pilot's menu, brand and prices under
// someone else's URL. These tests fail if that fallback ever comes back.

const PILOT_NAME = 'Júnior da Picanha';

// mockApi answers /menu with the pilot fixture for ANY slug, which is exactly
// the fallback we must not rely on. Registering this afterwards makes the
// unknown slug 404 (Playwright checks the most recently added route first).
async function failMenuFor(page, slug) {
  await page.route(`**/restaurants/${slug}/**`, route =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ detail: 'Restaurant not found' })
    })
  );
}

test('an unknown slug shows the error screen and never serves another restaurant', async ({
  page
}) => {
  await mockApi(page);
  await failMenuFor(page, 'restaurante-que-nao-existe');

  await page.goto('/restaurant.html?slug=restaurante-que-nao-existe');

  await expect(page.locator('body')).toHaveClass(/app-error/);
  await expect(page.locator('#appLoaderTitle')).toHaveText('Restaurante não encontrado');
  // Retry cannot help a wrong slug, so it is not offered.
  await expect(page.locator('#appLoaderRetry')).toBeHidden();

  // The decisive assertion: nothing from the other tenant leaked onto the page.
  await expect(page.locator('body')).not.toContainText(PILOT_NAME);
  await expect(page).not.toHaveTitle(new RegExp(PILOT_NAME));
});

test('a URL with no slug at all fails closed instead of picking a default', async ({ page }) => {
  const { requests } = await trackRestaurantRequests(page);
  await mockApi(page);

  await page.goto('/restaurant.html');

  await expect(page.locator('#appLoaderTitle')).toHaveText('Restaurante não encontrado');
  await expect(page.locator('body')).not.toContainText(PILOT_NAME);
  // It must not even ask the API for a restaurant: there is no tenant to ask for.
  expect(requests).toHaveLength(0);
});

test('a valid slug still boots normally', async ({ page }) => {
  await mockApi(page);

  await page.goto(`/restaurant.html?slug=${SLUG}`);

  await expect(page.locator('body')).not.toHaveClass(/app-error/);
  await expect(page.locator('.mob-rest-name').first()).toHaveText(PILOT_NAME);
});

test('the slug is resolved from the subdomain, not only the path', async ({ page }) => {
  // No DNS needed: resolveSlugFrom() takes an injected location, which is the
  // whole point of it being pure.
  await page.goto(`/restaurant.html?slug=${SLUG}`);

  const resolved = await page.evaluate(() =>
    window.RapidexTenant.resolveSlugFrom({
      hostname: 'fuji.rapidex.com',
      pathname: '/',
      search: '?slug=junior-da-picanha',
      rootDomains: ['rapidex.com']
    })
  );
  // Subdomain wins over the query string: <slug>.rapidex.com is the tenant.
  expect(resolved).toBe('fuji');
});

async function trackRestaurantRequests(page) {
  const requests = [];
  page.on('request', request => {
    if (/\/restaurants\//.test(request.url())) requests.push(request.url());
  });
  return { requests };
}
