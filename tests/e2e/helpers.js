import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const readFixture = (name) =>
  JSON.parse(readFileSync(resolve(here, '..', 'fixtures', name), 'utf8'));

export const MENU = readFixture('menu.json');
export const INFO = readFixture('info.json');

export const SLUG = 'junior-da-picanha';
export const BRANCH_MATRIZ = '4b054122-ee72-424c-817c-110f02c6b994';
export const PRODUCT_H2O = '80f16645-1d6b-4fca-b9e4-dd838e4134d2';
export const RESTAURANT_URL = `/restaurant.html?slug=${SLUG}`;

function json(body, status = 200) {
  return { status, contentType: 'application/json', body: JSON.stringify(body) };
}

/**
 * Intercept every API call so the app never reaches the network. GET endpoints
 * return fixtures; POST /orders is delegated to `onCreateOrder(route, request)`
 * so each test decides how the order call behaves (success, failure, counting).
 *
 * Returns { orderRequests } — a live array of every POST /orders seen, with its
 * parsed body and Idempotency-Key header, for asserting the Fase 1 invariants.
 */
export async function mockApi(page, { onCreateOrder } = {}) {
  const orderRequests = [];

  await page.route('**/api.pederapidex.com/**', async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();

    if (method === 'POST' && /\/orders(\?|$)/.test(url)) {
      orderRequests.push({
        idempotencyKey: request.headers()['idempotency-key'] || null,
        body: JSON.parse(request.postData() || '{}')
      });
      if (onCreateOrder) return onCreateOrder(route, request, orderRequests.length);
      return route.fulfill(json(successOrder(orderRequests.length)));
    }

    if (/\/menu(\?|$)/.test(url)) return route.fulfill(json(MENU));
    if (/\/info(\?|$)/.test(url)) return route.fulfill(json(INFO));
    if (/\/delivery\/estimate/.test(url)) {
      return route.fulfill(json({ serviceable: true, delivery_fee: 5, eta_min: 30, eta_max: 60 }));
    }
    if (/\/coupons/.test(url)) return route.fulfill(json({ coupons: [] }));
    if (/\/customers\/me/.test(url)) return route.fulfill(json({}, 401));
    // Anything else the app happens to call: benign empty 200.
    return route.fulfill(json({}));
  });

  return { orderRequests };
}

export function successOrder(n = 1) {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    order_number: 4200 + n,
    status: 'pending',
    subtotal: 21.15,
    delivery_fee: 0,
    service_fee: 0.99,
    coupon_discount_amount: '0.00',
    discount_total: '0.00',
    cashback_redeemed_amount: '0.00',
    total: 22.14,
    message: 'Pedido criado com sucesso'
  };
}

// Seed a confirmed pickup context + a guest identity BEFORE the app boots, so
// the test starts on the money path instead of the operation/address setup.
export async function seedPickupSession(page) {
  await page.addInitScript(
    ({ slug, branchId }) => {
      localStorage.setItem(
        `rapidex.operationContext.${slug}`,
        JSON.stringify({ order_type: 'pickup', branch_id: branchId, branch_label: 'Matriz', confirmed: true })
      );
      // Chave única e global da sessão (Fase 3). Sem slug: a conta é do
      // Rapidex, não do restaurante.
      localStorage.setItem(
        'rapidex.customer.profile',
        JSON.stringify({ name: 'E2E Test', phone: '85999999999' })
      );
    },
    { slug: SLUG, branchId: BRANCH_MATRIZ }
  );
}

// Drive product -> cart via the app's own functions (robust against the huge
// unknown DOM), then assert on real rendering and real network afterwards.
export async function addH2OToCart(page, qty = 3) {
  // Boot finished => the menu payload (products array) is loaded and openProduct resolves it.
  await page.waitForFunction(
    () => typeof window.openProduct === 'function' && !document.body.classList.contains('app-booting')
  );
  await page.evaluate(
    ({ productId, qty }) => {
      window.openProduct(productId);
      for (let i = 1; i < qty; i++) window.changeQty(1);
      window.addToCart();
    },
    { productId: PRODUCT_H2O, qty }
  );
}
