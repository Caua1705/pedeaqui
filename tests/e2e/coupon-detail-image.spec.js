import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockApi, RESTAURANT_URL, seedPickupSession } from './helpers.js';

const here = dirname(fileURLToPath(import.meta.url));
const LOCAL_WEBP = readFileSync(
  resolve(here, '..', '..', 'assets', 'brand', 'rapi-mascot@1x.webp')
);
const FIRST_COUPON_IMAGE = 'coupon-10-percent-off.webp';

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  serviceWorkers: 'block'
});

function isLargeFirstCouponVariant(rawUrl) {
  const url = new URL(rawUrl);
  return (
    url.pathname.includes('/storage/v1/render/image/public/') &&
    url.pathname.endsWith(`/${FIRST_COUPON_IMAGE}`) &&
    Number(url.searchParams.get('width')) >= 414
  );
}

test('detalhe mantem a miniatura pronta ate a foto grande terminar', async ({ page }) => {
  await mockApi(page);
  await seedPickupSession(page);

  let releaseLargeImage;
  const largeImageGate = new Promise((resolveGate) => {
    releaseLargeImage = resolveGate;
  });

  // Nenhuma imagem externa participa do teste. Todas as URLs do Storage usam
  // o mesmo WebP local; apenas a variante grande do primeiro cupom fica presa.
  await page.route(/https:\/\/[^/]+\.supabase\.co\/storage\/v1\//, async (route) => {
    if (isLargeFirstCouponVariant(route.request().url())) await largeImageGate;
    await route.fulfill({
      status: 200,
      contentType: 'image/webp',
      body: LOCAL_WEBP
    });
  });

  try {
    await page.goto(RESTAURANT_URL);
    await page.waitForFunction(() => !document.body.classList.contains('app-booting'));

    const couponCard = page.locator('#couponRail .coupon-card').first();
    const cardImage = couponCard.locator('.coupon-art img');
    await expect(couponCard).toBeVisible();
    await expect
      .poll(() => cardImage.evaluate((image) => image.complete && image.naturalWidth > 0))
      .toBe(true);

    const thumbnailSrc = await cardImage.evaluate((image) => image.currentSrc);
    expect(new URL(thumbnailSrc).searchParams.get('width')).toBe('168');

    const largeRequest = page.waitForRequest((request) =>
      isLargeFirstCouponVariant(request.url())
    );
    await couponCard.click();
    await largeRequest;

    const overlay = page.locator('#couponDetailOverlay');
    const art = page.locator('#couponDetailArt');
    const preview = art.locator('.detail-image-preview');
    const fullImage = art.locator('.detail-image-full');

    await expect(overlay).toHaveClass(/active/);
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute('src', thumbnailSrc);
    await expect(fullImage).toHaveCSS('opacity', '0');
    await expect(preview).toHaveCount(1);

    const pendingState = await art.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage
      };
    });
    expect(pendingState).toEqual({
      backgroundColor: 'rgb(242, 242, 242)',
      backgroundImage: 'none'
    });

    releaseLargeImage();

    await expect(fullImage).toHaveClass(/is-ready/);
    await expect(preview).toHaveCount(0);
    await expect
      .poll(() => fullImage.evaluate((image) => image.complete && image.naturalWidth > 0))
      .toBe(true);
    expect(
      Number(new URL(await fullImage.evaluate((image) => image.currentSrc)).searchParams.get('width'))
    ).toBeGreaterThanOrEqual(414);
  } finally {
    releaseLargeImage?.();
  }
});
