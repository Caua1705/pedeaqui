import { test, expect } from '@playwright/test';
import {
  mockApi,
  seedPickupSession,
  addH2OToCart,
  successOrder,
  PRODUCT_H2O,
  RESTAURANT_URL
} from './helpers.js';

// Drives product -> cart -> review -> confirm on the BUILT app, with every API
// call mocked (no production traffic, no real orders). Also pins the Fase 1
// invariants: one request per double-click, and a retry reuses the key.

async function goToReview(page) {
  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3); // 3 x R$7,05 = R$21,15, above the R$20 minimum

  // Fase 3 (item 7): on pickup the CTA no longer demands a delivery address, so
  // the test drives the real button instead of calling openCheckout() directly.
  // If the address gate ever comes back on pickup, this click stops working.
  await page.evaluate(() => window.openModal('cartModal'));
  const cta = page.locator('#cartCtaBtn');
  await expect(cta).not.toHaveText('Informe seu endereço');
  await cta.click();

  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await page.locator('.payment-method-confirm').click();

  await expect(page.locator('#orderReviewModal')).toHaveClass(/active/);
  await expect(page.locator('#orvConfirmBtn')).toBeEnabled();
}

test('product -> cart -> review -> confirm creates an order and shows the real number', async ({
  page
}) => {
  const { orderRequests } = await mockApi(page);
  await seedPickupSession(page);

  await goToReview(page);

  // Review reflects the cart the user built.
  await expect(page.locator('#orvItems')).toContainText('H2O');
  await expect(page.locator('#orvTotal')).toContainText('22,14');
  await expect(page.locator('#orvPayment')).toContainText('Pix');

  await page.locator('#orvConfirmBtn').click();

  // Success screen is filled from the createOrder RESPONSE, not hardcoded.
  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/);
  await expect(page.locator('#ordSuccessNumber')).toHaveText(`#${successOrder(1).order_number}`);
  await expect(page.locator('#ordSuccessTotal')).toContainText('22,14');

  // Exactly one order was created, with the contract-shaped payload.
  expect(orderRequests).toHaveLength(1);
  const { body } = orderRequests[0];
  expect(body.order_type).toBe('pickup');
  expect(body.payment_method).toBe('pix');
  expect(body.items[0]).toMatchObject({ product_id: expect.any(String), quantity: 3 });
  expect(body).not.toHaveProperty('total'); // backend is authoritative

  // Cart is cleared only after confirmed success.
  const cartCount = await page.evaluate(
    () => (window.PedeAquiCartStore?.get?.().items || []).length
  );
  expect(cartCount).toBe(0);
});

test('double-click on Confirm creates only ONE order', async ({ page }) => {
  // Hold the response open briefly so both clicks land while the request is in flight.
  const { orderRequests } = await mockApi(page, {
    onCreateOrder: async (route) => {
      await new Promise((r) => setTimeout(r, 800));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(successOrder(1))
      });
    }
  });
  await seedPickupSession(page);
  await goToReview(page);

  const confirm = page.locator('#orvConfirmBtn');
  await confirm.click();
  await confirm.click({ force: true }).catch(() => {}); // second click while disabled/in-flight

  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/);
  expect(orderRequests).toHaveLength(1);
});

test('a retry after a network failure reuses the same Idempotency-Key', async ({ page }) => {
  // Fail the first attempt at the network layer, succeed on the second.
  const { orderRequests } = await mockApi(page, {
    onCreateOrder: async (route, _request, attempt) => {
      if (attempt === 1) return route.abort('connectionfailed');
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(successOrder(2))
      });
    }
  });
  await seedPickupSession(page);
  await goToReview(page);

  await page.locator('#orvConfirmBtn').click();

  // First attempt failed: error shown, cart intact, button re-enabled.
  await expect(page.locator('#orvError')).toBeVisible();
  await expect(page.locator('#orvConfirmBtn')).toBeEnabled();

  await page.locator('#orvConfirmBtn').click();
  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/);

  expect(orderRequests).toHaveLength(2);
  expect(orderRequests[0].idempotencyKey).toBeTruthy();
  expect(orderRequests[1].idempotencyKey).toBe(orderRequests[0].idempotencyKey);
});
test('guest adds one item, sees the bag, and is gated only by the cart CTA', async ({ page }) => {
  await mockApi(page);
  await page.route('**/coupons/preview', route => route.fulfill({
    status: 401,
    contentType: 'application/json',
    body: JSON.stringify({ message: 'Authentication required' })
  }));

  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await expect(page.locator('#operationModal')).not.toHaveClass(/active/);

  // A public coupon may be selected before the guest has any cart items.
  // Its automatic preview must never hijack Add-to-cart with the login modal.
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await page.locator('.coupon-detail-use').click();
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await expect(page.locator('#operationModal')).not.toHaveClass(/active/);

  await page.evaluate(productId => window.openProduct(productId), PRODUCT_H2O);
  await page.locator('#pmAddBtn').click();

  await page.waitForTimeout(250);
  await expect(page.locator('#productModal')).not.toHaveClass(/active/);
  await expect(page.locator('#cartModal')).not.toHaveClass(/active/);
  await expect(page.locator('#loginModal')).not.toHaveClass(/active/);
  await expect(page.locator('#cartList .cart-item-row')).toHaveCount(1);
  await expect(page.locator('#cartItemCountLabel')).toHaveText('1 item');

  await page.locator('#cartStickyBtn').evaluate(button => button.click());
  await expect(page.locator('#cartModal')).toHaveClass(/active/);

  const cta = page.locator('#cartCtaBtn');
  await expect(cta).toHaveText('Informe seu endereço');
  await page.locator('#cartTabRetirada').click();
  await expect(cta).toHaveText('Entre ou cadastre-se');
  await expect(page.locator('#loginModal')).not.toHaveClass(/active/);
});
