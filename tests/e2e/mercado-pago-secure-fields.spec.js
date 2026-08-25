import { test, expect } from '@playwright/test';
import { mockApi, addH2OToCart, RESTAURANT_URL, SLUG, BRANCH_MATRIZ } from './helpers.js';

// Opt-in: usa a chave pública do ambiente escolhido sem acoplar o CI à produção.
const publicKey = process.env.PAYMENT_PUBLIC_KEY;
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('Secure Fields real tokeniza o cartão de teste e a requisição leva apenas o token', async ({ page }) => {
  test.skip(!publicKey, 'PAYMENT_PUBLIC_KEY ausente');
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.addInitScript(({ slug, branchId }) => {
    const address = {
      street: 'Rua Andrade Furtado', number: '955', complement: 'Ao 1802 bloco LUZ',
      neighborhood: 'Cocó', city: 'Fortaleza', state: 'Ceará', postal_code: '60190090',
      summary: 'Rua Andrade Furtado, 955 - Cocó'
    };
    localStorage.setItem('rapidex.customer.token', 'live-secure-fields-token');
    localStorage.setItem('rapidex.customer.profile', JSON.stringify({
      id: 'customer-live-sdk', name: 'Cliente Teste', phone: '85999999999', email: 'cliente@example.com'
    }));
    localStorage.setItem('rapidex.customerAddress', JSON.stringify(address));
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: 'delivery', branch_id: branchId, branch_label: 'Matriz', address, confirmed: true
    }));
  }, { slug: SLUG, branchId: BRANCH_MATRIZ });

  const posts = [];
  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({ balance: 0, transactions: [] })));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json({
    id: 'customer-live-sdk', name: 'Cliente Teste', phone: '85999999999', email: 'cliente@example.com'
  })));
  await page.route('**/payment-config', route => route.fulfill(json({
    provider: 'mercadopago', public_key: publicKey, card_enabled: true
  })));
  await page.route('**/customers/me/cards**', route => {
    if (route.request().method() === 'GET') return route.fulfill(json([]));
    if (route.request().method() === 'POST') {
      posts.push(JSON.parse(route.request().postData() || '{}'));
      return route.fulfill(json({
        id: '33333333-3333-4333-8333-333333333333', brand: 'master', last_four_digits: '6351',
        expiration_month: 11, expiration_year: 2031, created_at: '2026-08-25T18:00:00Z'
      }, 201));
    }
    return route.fulfill({ status: 204 });
  });

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('#paymentAddCard').click();
  await page.locator('#addCreditCardOption').click();

  await page.frameLocator('#mpCardNumber iframe').locator('#cardNumber').fill('5031433215406351');
  await page.frameLocator('#mpExpirationDate iframe').locator('#expirationDate').fill('11/31');
  await page.frameLocator('#mpSecurityCode iframe').locator('#securityCode').fill('123');
  await page.locator('#cardholderName').fill('APRO');
  await page.locator('#cardholderCpf').fill('12345678909');
  await page.locator('.billing-copy-address').click();
  await page.locator('#saveCreditCardButton').click();

  await expect(page.locator('#cartPaymentLabel')).toHaveText('Crédito - Mastercard •••• 6351');
  expect(posts).toHaveLength(1);
  expect(Object.keys(posts[0]).sort()).toEqual(['restaurant_slug', 'token']);
  expect(posts[0].restaurant_slug).toBe(SLUG);
  expect(posts[0].token).toEqual(expect.any(String));
  expect(posts[0].token.length).toBeGreaterThan(10);
  expect(JSON.stringify(posts)).not.toContain('5031433215406351');
  expect(JSON.stringify(posts)).not.toContain('12345678909');
});
