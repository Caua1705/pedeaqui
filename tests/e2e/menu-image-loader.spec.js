import { test, expect } from '@playwright/test';
import { MENU, mockApi, RESTAURANT_URL, seedPickupSession } from './helpers.js';

test.use({ viewport: { width: 390, height: 844 } });

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'base64'
);

async function boot(page, imageTag) {
  await mockApi(page);
  const menu = JSON.parse(JSON.stringify(MENU));
  menu.products.forEach((product, index) => {
    if (product.image_url || product.image_path) {
      product.image_url = `https://menu-images.test/products/${imageTag}-${index}.png`;
      product.image_path = '';
    }
  });
  await page.route('**/api.pederapidex.com/**', async (route) => {
    if (!/\/menu(\?|$)/.test(route.request().url())) return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(menu)
    });
  });
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
}

test('mostra o loader de tela inteira somente quando as fotos visíveis demoram', async ({
  page
}) => {
  let releaseImages;
  const imagesReleased = new Promise((resolve) => {
    releaseImages = resolve;
  });

  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes('/products/')) return route.fallback();
    await imagesReleased;
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });

  await boot(page, 'slow');
  // Dispara sem devolver a Promise: o teste precisa observar o estado
  // intermediário enquanto as imagens continuam bloqueadas.
  await page.evaluate(() => {
    window.mobNavMenu?.();
  });

  await expect(page.locator('body')).toHaveClass(/menu-media-loading/);
  await expect(page.locator('#appLoader')).toBeVisible();
  await expect(page.locator('#appLoaderTitle')).toHaveText('Carregando cardápio');

  releaseImages();
  await expect(page.locator('body')).not.toHaveClass(/menu-media-loading/);
  await expect(page.locator('.product-image').first()).toHaveJSProperty('complete', true);
});

test('não pisca o loader quando as fotos já chegam rápido', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes('/products/')) return route.fallback();
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });

  await boot(page, 'fast');
  await page.evaluate(() => {
    window.__menuLoaderAppeared = false;
    new MutationObserver(() => {
      if (document.body.classList.contains('menu-media-loading'))
        window.__menuLoaderAppeared = true;
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.mobNavMenu?.();
  });

  await expect(page.locator('.product-image').first()).toHaveJSProperty('complete', true);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.__menuLoaderAppeared)).toBe(false);
});
