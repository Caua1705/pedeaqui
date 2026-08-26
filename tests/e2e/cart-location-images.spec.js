import { test, expect } from '@playwright/test';
import { mockApi, addH2OToCart, SLUG, BRANCH_MATRIZ } from './helpers.js';

const address = {
  street: 'Rua Eduardo Garcia',
  number: '1019',
  neighborhood: 'Aldeota',
  city: 'Fortaleza',
  state: 'CE',
  summary: 'Rua Eduardo Garcia, 1019 - Aldeota'
};

async function seedDelivery(page, logged) {
  await page.addInitScript(({ slug, branchId, deliveryAddress, hasLogin }) => {
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: 'delivery',
      branch_id: branchId,
      branch_label: 'Matriz',
      confirmed: true,
      address: deliveryAddress
    }));
    localStorage.setItem('rapidex.customerAddress', JSON.stringify(deliveryAddress));
    if (hasLogin) {
      localStorage.setItem('rapidex.customer.token', 'cart-location-image-token');
      localStorage.setItem('rapidex.customer.profile', JSON.stringify({
        id: 'customer-cart-location',
        name: 'Cliente Teste',
        phone: '85999999999'
      }));
    }
  }, { slug: SLUG, branchId: BRANCH_MATRIZ, deliveryAddress: address, hasLogin: logged });
}

async function expectCartLocationImage(page, expectedName) {
  await addH2OToCart(page, 1);
  await page.evaluate(() => window.openModal('cartModal'));
  const image = page.locator('#cartLocationImage');
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate(element => element.complete && element.naturalWidth > 0)).toBe(true);
  const currentPath = await image.evaluate(element => new URL(element.currentSrc).pathname);
  expect(currentPath).toMatch(new RegExp(`^/assets/icons/cart/${expectedName}@(1x|2x)\\.webp$`));
}

test('sacola no celular carrega o mapa do visitante pela URL instalada do restaurante', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedDelivery(page, false);
  await mockApi(page);
  await page.goto(`/${SLUG}/`);
  await expectCartLocationImage(page, 'cart-location-guest');
});

test('sacola no celular carrega o cliente logado pela URL instalada do restaurante', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedDelivery(page, true);
  await mockApi(page);
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ id: 'customer-cart-location', name: 'Cliente Teste', phone: '85999999999' })
  }));
  await page.route('**/customers/me/addresses**', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify([address])
  }));
  await page.goto(`/${SLUG}/`);
  await expectCartLocationImage(page, 'cart-location-customer');
});
