import { expect } from '@playwright/test';
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
 * return fixtures; the order endpoints are delegated to per-test handlers so
 * each test decides how they behave (success, failure, counting).
 *
 * @param {object} [handlers]
 * @param {Function} [handlers.onCreateOrder]  POST /restaurants/{slug}/orders
 * @param {Function} [handlers.onStartPayment] POST /orders/{token}/payment
 * @param {Function} [handlers.onTrackOrder]   GET  /orders/track/{token}
 * @param {Function} [handlers.orderResponse]  body of the default created order
 *
 * Returns live arrays of every order/payment/tracking call seen, so a test can
 * assert BOTH what was sent and how many times. `paymentRequests` and
 * `trackRequests` are what pin the Pix flow: a charge is created once, and the
 * polling stops when it stops.
 */
export async function mockApi(page, { onCreateOrder, onStartPayment, onTrackOrder, orderResponse } = {}) {
  const orderRequests = [];
  const paymentRequests = [];
  const trackRequests = [];

  await page.route('**/api.pederapidex.com/**', async (route) => {
    const request = route.request();
    const url = request.url();
    const method = request.method();

    // POST /restaurants/{slug}/orders/{tracking_token}/payment
    if (method === 'POST' && /\/orders\/[^/]+\/payment(\?|$)/.test(url)) {
      paymentRequests.push({ url, token: url.match(/\/orders\/([^/]+)\/payment/)?.[1] });
      if (onStartPayment) return onStartPayment(route, request, paymentRequests.length);
      return route.fulfill(json(pixCharge()));
    }

    // GET /restaurants/{slug}/orders/track/{tracking_token}
    if (method === 'GET' && /\/orders\/track\//.test(url)) {
      trackRequests.push({ url, token: url.split('/orders/track/')[1] });
      if (onTrackOrder) return onTrackOrder(route, request, trackRequests.length);
      return route.fulfill(json(trackedOrder({ payment_status: 'pending' })));
    }

    if (method === 'POST' && /\/orders(\?|$)/.test(url)) {
      orderRequests.push({
        idempotencyKey: request.headers()['idempotency-key'] || null,
        body: JSON.parse(request.postData() || '{}')
      });
      if (onCreateOrder) return onCreateOrder(route, request, orderRequests.length);
      const body = orderResponse
        ? orderResponse(orderRequests.length)
        : successOrder(orderRequests.length);
      return route.fulfill(json(body));
    }

    // A rota pública por telefone NÃO EXISTE MAIS. Se o app voltar a chamá-la,
    // o teste precisa quebrar aqui em vez de receber um 200 benigno lá embaixo.
    if (/\/orders\/[^/]+\?.*phone=/.test(url)) {
      return route.fulfill(json({ detail: 'rota removida' }, 410));
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

  return { orderRequests, paymentRequests, trackRequests };
}

export const TRACKING_TOKEN = 'trk_e2e_0000000000000000';

// Payload EMV de Pix (copia e cola), no formato que o gateway devolve.
export const PIX_QR_CODE =
  '00020126580014BR.GOV.BCB.PIX0136123e4567-e12b-12d1-a456-42665544000052040000530398654041.005802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D';

/**
 * CreateOrderResponse do fluxo PAGO NA ENTREGA — o caminho que já existia.
 * tracking_token vem mesmo aqui: é ele que dá acesso ao pedido agora que a
 * consulta por telefone saiu da API.
 */
export function successOrder(n = 1, overrides = {}) {
  return {
    id: `00000000-0000-4000-8000-00000000000${n}`,
    order_number: 4200 + n,
    tracking_token: `${TRACKING_TOKEN}${n}`,
    status: 'pending',
    payment_flow: 'delivery',
    payment_status: 'not_required',
    subtotal: 21.15,
    delivery_fee: 0,
    service_fee: 0.99,
    coupon_discount_amount: '0.00',
    discount_total: '0.00',
    cashback_redeemed_amount: '0.00',
    total: 22.14,
    message: 'Pedido criado com sucesso',
    ...overrides
  };
}

/** CreateOrderResponse do fluxo ONLINE: nasce aguardando a cobrança. */
export function pixOrder(n = 1, overrides = {}) {
  return successOrder(n, { payment_flow: 'online', payment_status: 'pending', ...overrides });
}

/** StartPaymentResponse com QR e checkout, como um gateway real de Pix. */
export function pixCharge(overrides = {}) {
  return {
    provider: 'e2e-gateway',
    provider_payment_id: 'pay_e2e_1',
    payment_status: 'pending',
    qr_code: PIX_QR_CODE,
    checkout_url: 'https://pagamento.example.com/checkout/pay_e2e_1',
    ...overrides
  };
}

/** OrderDetailResponse da rota pública de acompanhamento. */
export function trackedOrder(overrides = {}) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    order_number: 4201,
    restaurant_id: '11111111-1111-4111-8111-111111111111',
    branch_id: BRANCH_MATRIZ,
    customer_name_snapshot: 'E2E Test',
    customer_phone_snapshot: '85999999999',
    order_type: 'pickup',
    status: 'pending',
    payment_method: 'pix',
    payment_flow: 'online',
    payment_status: 'pending',
    subtotal: 21.15,
    delivery_fee: 0,
    service_fee: 0.99,
    discount_total: '0.00',
    coupon_discount_amount: '0.00',
    cashback_redeemed_amount: '0.00',
    total: 22.14,
    items: [],
    status_history: [],
    ...overrides
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

/**
 * Confirma o pedido na folha que sobe sobre a sacola — o passo que fica ENTRE
 * o botão da sacola e a criação do pedido. Toda rota que cria pedido passa por
 * aqui; um spec que clique só no CTA da sacola nunca vê o POST /orders.
 */
export async function confirmOrderSheet(page) {
  const sheet = page.locator('#orderConfirmSheet');
  await expect(sheet).toHaveClass(/active/);
  await sheet.locator('.order-confirm-cta').click();
}

/**
 * Leva o app de produto -> sacola -> Pix escolhido -> de volta na sacola, com a
 * sacola pronta para submeter. As esperas intermediárias não são decoração: a
 * sacola só recalcula o CTA depois que o método é confirmado, e clicar antes
 * disso pega um botão ainda sem rótulo.
 */
export async function selectPixAndReturnToCart(page, qty = 3) {
  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, qty); // 3 x R$7,05 = R$21,15, acima do mínimo

  await page.evaluate(() => window.openModal('cartModal'));
  const cta = page.locator('#cartCtaBtn');
  await expect(cta).not.toHaveText('Informe seu endereço');
  await cta.click();

  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await expect(page.locator('#paymentMethodFooter')).toBeVisible();
  await page.locator('.payment-method-confirm').click();

  await expect(page.locator('#paymentMethodModal')).not.toHaveClass(/active/);
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await expect(cta).toHaveText('Efetuar pagamento');
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
