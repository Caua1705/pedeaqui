import { readFileSync } from 'node:fs';
import { test, expect } from '@playwright/test';
import { MENU, mockApi, RESTAURANT_URL, seedPickupSession, esperarAppPronto } from './helpers.js';

// Um WebP pequeno qualquer, só para o teste ter bytes de imagem de verdade.
const LOCAL_WEBP = readFileSync(new URL('../../assets/brand/pedeaqui-logo@1x.webp', import.meta.url));
const FIRST_PRODUCT = MENU.products[0];

test.use({ viewport: { width: 390, height: 844 } });

test('mantem a miniatura visivel ate a imagem grande do produto ficar pronta', async ({ page }) => {
  let releaseLargeImage;
  let largeImageRequested = false;
  const largeImageGate = new Promise((resolve) => {
    releaseLargeImage = resolve;
  });
  const firstProductPath = new URL(FIRST_PRODUCT.image_url).pathname;

  await mockApi(page);
  await seedPickupSession(page);
  await page.route('**/storage/v1/**', async (route) => {
    const url = new URL(route.request().url());
    const width = Number(url.searchParams.get('width') || 0);
    const isLargeFirstProduct = url.pathname.endsWith(firstProductPath.split('/').pop()) && width >= 360;

    if (isLargeFirstProduct) {
      largeImageRequested = true;
      await largeImageGate;
    }

    await route.fulfill({
      status: 200,
      contentType: 'image/webp',
      body: LOCAL_WEBP
    });
  });

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.mobNavMenu?.());

  const card = page.locator(`.product-card[data-product-id="${FIRST_PRODUCT.id}"]`);
  const thumbnail = card.locator('.product-image');
  await expect(card).toBeVisible();
  await expect.poll(() => thumbnail.evaluate((image) => image.complete && image.naturalWidth > 0)).toBe(true);

  await card.click();

  const modal = page.locator('#productModal');
  const preview = modal.locator('#pmHero .detail-image-preview');
  const fullImage = modal.locator('#pmHero .detail-image-full');

  await expect(modal).toHaveClass(/active/);
  await expect.poll(() => largeImageRequested).toBe(true);
  await expect(preview).toBeVisible();
  await expect.poll(() => preview.evaluate((image) => {
    const style = getComputedStyle(image);
    return image.complete && image.naturalWidth > 0 && style.opacity === '1';
  })).toBe(true);
  await expect(fullImage).not.toHaveClass(/is-ready/);
  await expect(fullImage).toHaveCSS('opacity', '0');

  releaseLargeImage();

  await expect(fullImage).toHaveClass(/is-ready/);
  await expect(fullImage).toHaveCSS('opacity', '1');
  await expect(preview).toHaveCount(0);
});
