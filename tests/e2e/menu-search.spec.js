import { test, expect } from '@playwright/test';
import { mockApi, RESTAURANT_URL, seedPickupSession, esperarAppPronto } from './helpers.js';

test.use({ viewport: { width: 390, height: 844 } });

async function bootMenu(page) {
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.mobNavMenu?.());
  await page.waitForFunction(() => document.querySelectorAll('.product-card').length > 1);
}

test('a pesquisa esconde as categorias e mostra somente produtos encontrados', async ({ page }) => {
  await bootMenu(page);

  const allProducts = page.locator('.product-card');
  const initialCount = await allProducts.count();
  expect(initialCount).toBeGreaterThan(1);

  await page.locator('#searchInput').fill('pudim');

  await expect(page.locator('body')).toHaveClass(/menu-search-active/);
  await expect(page.locator('#catNav')).toBeHidden();
  await expect(page.locator('.menu-section-title').first()).toBeHidden();

  const visibleNames = page.locator('.product-card:visible .product-name');
  await expect.poll(() => visibleNames.count()).toBeGreaterThan(0);
  const resultNames = await visibleNames.allTextContents();
  expect(resultNames.length).toBeLessThan(initialCount);
  expect(resultNames.every(name => name.toLowerCase().includes('pudim'))).toBe(true);

  await page.locator('#searchInput').fill('');

  await expect(page.locator('body')).not.toHaveClass(/menu-search-active/);
  await expect(page.locator('#catNav')).toBeVisible();
  await expect(page.locator('.menu-section-title').first()).toBeVisible();
  await expect(page.locator('.product-card:visible')).toHaveCount(initialCount);
});
