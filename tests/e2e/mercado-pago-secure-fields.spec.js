import { test, expect } from '@playwright/test';
import { mockApi, addH2OToCart, RESTAURANT_URL, SLUG, BRANCH_MATRIZ } from './helpers.js';

// Opt-in: usa a chave pública do ambiente escolhido sem acoplar o CI à produção.
const publicKey = process.env.PAYMENT_PUBLIC_KEY;
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

test('Secure Fields real tokeniza o cartão de teste e a requisição leva apenas o token', async ({ page }) => {
  test.skip(!publicKey, 'PAYMENT_PUBLIC_KEY ausente');
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
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

  await expect(page.locator('#creditCardModal')).not.toContainText('Carregando...');
  await expect(page.locator('#creditCardModal .payment-secure-field.is-loading')).toHaveCount(0);
  await expect(page.locator('#creditCardModal .payment-card-screen')).toHaveCSS('background-color', 'rgb(247, 245, 243)');
  // Reproduz o gesto do cliente: clica na área visível, sem acessar o input
  // interno do iframe pelo seletor de teste.
  await expect(page.locator('#mpCardNumber iframe')).toHaveCount(1);
  await page.locator('#mpCardNumber').click();
  await page.keyboard.type('5031433215406351');
  await expect(page.frameLocator('#mpCardNumber iframe').locator('#cardNumber')).toHaveValue('5031 4332 1540 6351');
  await page.locator('#mpExpirationDate').click();
  await page.keyboard.type('11/31');
  await expect(page.frameLocator('#mpExpirationDate iframe').locator('#expirationDate')).toHaveValue('11/31');
  await page.locator('#mpSecurityCode').click();
  await page.keyboard.type('123');
  await expect(page.frameLocator('#mpSecurityCode iframe').locator('#securityCode')).toHaveValue('123');
  await page.locator('#cardholderName').fill('APRO');
  await page.locator('#cardholderCpf').fill('12345678909');
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

test('Secure Fields real informa Luhn, validade futura e tamanho do CVV no campo correto', async ({ page }) => {
  test.skip(!publicKey, 'PAYMENT_PUBLIC_KEY ausente');
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await page.addInitScript(({ slug, branchId }) => {
    const address = {
      street: 'Rua Andrade Furtado', number: '955', neighborhood: 'Cocó', city: 'Fortaleza',
      state: 'Ceará', postal_code: '60190090', summary: 'Rua Andrade Furtado, 955 - Cocó'
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
  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({ balance: 0, transactions: [] })));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json({
    id: 'customer-live-sdk', name: 'Cliente Teste', phone: '85999999999', email: 'cliente@example.com'
  })));
  await page.route('**/payment-config', route => route.fulfill(json({
    provider: 'mercadopago', public_key: publicKey, card_enabled: true
  })));
  await page.route('**/customers/me/cards**', route => route.fulfill(json([])));

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('#paymentAddCard').click();
  await page.locator('#addCreditCardOption').click();
  await expect(page.locator('#saveCreditCardButton')).toBeEnabled();

  await page.frameLocator('#mpCardNumber iframe').locator('#cardNumber').click();
  await page.keyboard.type('41111111');
  await page.waitForTimeout(1500);
  await page.keyboard.type('11111112', { delay: 30 });
  await page.frameLocator('#mpExpirationDate iframe').locator('#expirationDate').click();
  await page.keyboard.type('11/31');
  await page.frameLocator('#mpSecurityCode iframe').locator('#securityCode').click();
  await page.keyboard.type('123');
  await page.locator('#cardholderName').fill('APRO');
  await page.locator('#cardholderCpf').fill('12345678909');
  await page.locator('#saveCreditCardButton').click();
  await expect(page.locator('#cardNumberError')).toHaveText('Número do cartão inválido');

  const number = page.frameLocator('#mpCardNumber iframe').locator('#cardNumber');
  await number.click();
  await number.press('Control+A');
  await page.keyboard.type('5031433215406351');
  const expiration = page.frameLocator('#mpExpirationDate iframe').locator('#expirationDate');
  await expiration.click();
  await expiration.press('Control+A');
  await page.keyboard.type('01/20');
  const cvv = page.frameLocator('#mpSecurityCode iframe').locator('#securityCode');
  await cvv.click();
  await cvv.press('Control+A');
  await page.keyboard.type('12');
  await page.locator('#cardholderCpf').fill('12345678900');
  await page.locator('#saveCreditCardButton').click();

  await expect(page.locator('#expirationDateError')).toHaveText('Informe uma data de validade futura');
  await expect(page.locator('#securityCodeError')).toHaveText('CVV inválido para a bandeira do cartão');
  await expect(page.locator('#cardholderCpfError')).toHaveText('CPF inválido');
});
