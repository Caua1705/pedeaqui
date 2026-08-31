import { test, expect } from '@playwright/test';
import { MENU, mockApi, RESTAURANT_URL, seedPickupSession, esperarAppPronto } from './helpers.js';

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
  await esperarAppPronto(page);
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
  // No primeiro quadro após o clique o loader já precisa estar na frente.
  // Se a classe entrar depois deste requestAnimationFrame, o cliente enxerga
  // o cardápio por um instante antes da cobertura.
  const firstFrame = await page.evaluate(() => new Promise(resolve => {
    window.mobNavMenu?.();
    requestAnimationFrame(() => resolve({
      menuVisible: document.body.classList.contains('menu-tab'),
      loaderVisible: document.body.classList.contains('menu-media-loading')
    }));
  }));

  expect(firstFrame).toEqual({ menuVisible: true, loaderVisible: true });

  await expect(page.locator('body')).toHaveClass(/menu-media-loading/);
  await expect(page.locator('#appLoader')).toBeVisible();
  await expect(page.locator('#appLoaderTitle')).toHaveText('Carregando cardápio');

  releaseImages();
  await expect(page.locator('body')).not.toHaveClass(/menu-media-loading/);
  await expect(page.locator('.product-image').first()).toHaveJSProperty('complete', true);

  // Na segunda entrada os mesmos pixels já estão prontos: a otimização de
  // cache continua valendo e não cria um loader desnecessário.
  await page.evaluate(() => {
    window.RapidexActions.resolve('mobNavHome')();
    window.__menuLoaderAppearedFromCache = false;
    new MutationObserver(() => {
      if (document.body.classList.contains('menu-media-loading')) {
        window.__menuLoaderAppearedFromCache = true;
      }
    }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
    window.mobNavMenu?.();
  });
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__menuLoaderAppearedFromCache)).toBe(false);
});

test('não revela o cardápio antes do loader mesmo quando as fotos respondem rápido', async ({ page }) => {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (!url.pathname.includes('/products/')) return route.fallback();
    return route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL });
  });

  await boot(page, 'fast');
  const firstFrame = await page.evaluate(() => new Promise(resolve => {
    window.mobNavMenu?.();
    requestAnimationFrame(() => resolve({
      menuVisible: document.body.classList.contains('menu-tab'),
      loaderVisible: document.body.classList.contains('menu-media-loading')
    }));
  }));

  expect(firstFrame).toEqual({ menuVisible: true, loaderVisible: true });
  await expect(page.locator('.product-image').first()).toHaveJSProperty('complete', true);
  await expect(page.locator('body')).not.toHaveClass(/menu-media-loading/);
});
