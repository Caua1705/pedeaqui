import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, RESTAURANT_URL } from './helpers.js';

async function readNavGeometry(page) {
  return page.evaluate(() => {
    const center = selector => {
      const rect = document.querySelector(selector).getBoundingClientRect();
      return {
        x: Math.round((rect.left + rect.width / 2) * 10) / 10,
        y: Math.round((rect.top + rect.height / 2) * 10) / 10
      };
    };

    return {
      home: center('#mobNavHome .nav-icon'),
      menu: center('#mobNavMenu .nav-icon'),
      assistant: center('#mobNavAssistantTab'),
      club: center('#mobNavOrders .nav-icon'),
      profile: center('#mobNavProfile .nav-icon')
    };
  });
}

async function expectSameGeometry(actual, expected) {
  for (const key of Object.keys(expected)) {
    expect(actual[key].x, `${key} moved horizontally`).toBeCloseTo(expected[key].x, 1);
    expect(actual[key].y, `${key} moved vertically`).toBeCloseTo(expected[key].y, 1);
  }
}

test('logged-in Club and Profile keep every navbar icon fixed', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPickupSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('rapidex.customer.token', 'e2e-navbar-token');
  });
  await mockApi(page);
  await page.route('**/api.pederapidex.com/**', async route => {
    const url = route.request().url();
    if (/\/customers\/me\/orders(?:\?|$)/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (/\/customers\/me\/addresses(?:\?|$)/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    }
    if (/\/customers\/me(?:\?|$)/.test(url)) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'customer-navbar', name: 'E2E Test' })
      });
    }
    return route.fallback();
  });

  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')());

  const homeGeometry = await readNavGeometry(page);

  await page.locator('#mobNavProfile').click();
  await expect(page.locator('#mobViewProfile')).toHaveClass(/active/);
  await expectSameGeometry(await readNavGeometry(page), homeGeometry);

  await page.locator('#mobNavOrders').click();
  await expect(page.locator('#mobViewClub')).toHaveClass(/active/);
  await expectSameGeometry(await readNavGeometry(page), homeGeometry);
});
