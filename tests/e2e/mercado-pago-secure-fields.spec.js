import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { mockApi, addH2OToCart, RESTAURANT_URL, SLUG, BRANCH_MATRIZ, validadeFutura } from './helpers.js';

// Opt-in: usa a chave pública do ambiente escolhido sem acoplar o CI à produção.
const publicKey = process.env.PAYMENT_PUBLIC_KEY;
const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const here = dirname(fileURLToPath(import.meta.url));
const CSP = JSON.parse(readFileSync(resolve(here, '..', '..', 'vercel.json'), 'utf8'))
  .headers[0].headers.find(header => header.key.toLowerCase() === 'content-security-policy').value;

/**
 * Serve o documento sob a CSP REAL de produção e devolve as violações.
 *
 * A csp.spec.js boota o app inteiro, mas com a API mockada: ela nunca chega no
 * SDK de verdade, e por isso não viu que `secure-fields.mercadopago.com` estava
 * só no frame-src. O SDK faz um `fetch` nesse host antes de montar o iframe —
 * sem ele em connect-src os campos não existem. Só um teste que roda o SDK
 * DE VERDADE sob a política de verdade pega isso; é este arquivo.
 */
async function underProductionCsp(page) {
  const violations = [];
  const consoleErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  await page.addInitScript(() => {
    window.__cspViolations = [];
    document.addEventListener('securitypolicyviolation', (event) => {
      window.__cspViolations.push(`${event.effectiveDirective || event.violatedDirective} bloqueou ${event.blockedURI}`);
    });
  });
  await page.route('**/restaurant.html*', async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'content-security-policy': CSP }
    });
  });
  return {
    collect: async () => {
      violations.push(...(await page.evaluate(() => window.__cspViolations)));
      return violations;
    },
    // O erro que a CSP produzia sem estourar teste nenhum: bloqueado o `fetch`,
    // o cliente REST do SDK rejeita com `undefined` e o `catch` dele lê
    // `undefined.message`. Nada disso chega ao nosso código — só ao console.
    consoleErrors: () => consoleErrors.filter(text => !/Google Maps/i.test(text))
  };
}

test('Secure Fields real tokeniza o cartão de teste e a requisição leva apenas o token', async ({ page }) => {
  test.skip(!publicKey, 'PAYMENT_PUBLIC_KEY ausente');
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  const csp = await underProductionCsp(page);
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
        id: '33333333-3333-4333-8333-333333333333', provider_card_id: '1562188766183',
        brand: 'master', last_four_digits: '6351',
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
  await page.keyboard.type(validadeFutura());
  await expect(page.frameLocator('#mpExpirationDate iframe').locator('#expirationDate')).toHaveValue(validadeFutura());
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

  const violations = await csp.collect();
  expect(violations, `violacoes de CSP:\n${violations.join('\n')}`).toEqual([]);
  expect(csp.consoleErrors(), `erros no console:\n${csp.consoleErrors().join('\n')}`).toEqual([]);
});

test('Secure Fields real informa Luhn, validade futura e tamanho do CVV no campo correto', async ({ page }) => {
  test.skip(!publicKey, 'PAYMENT_PUBLIC_KEY ausente');
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 390, height: 844 });
  const csp = await underProductionCsp(page);
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
  await page.keyboard.type(validadeFutura());
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

  const violations = await csp.collect();
  expect(violations, `violacoes de CSP:\n${violations.join('\n')}`).toEqual([]);
  expect(csp.consoleErrors(), `erros no console:\n${csp.consoleErrors().join('\n')}`).toEqual([]);
});

test('Secure Fields real: o CVV do cartão salvo chega até o createCardToken', async ({ page }) => {
  test.skip(!publicKey, 'PAYMENT_PUBLIC_KEY ausente');
  test.setTimeout(120_000);
  await page.setViewportSize({ width: 390, height: 844 });

  // A cobertura que existia deste fluxo usava um MOCK do SDK, cujo campo dispara
  // `ready` num microtask: qualquer motivo real para o campo não ficar pronto —
  // e portanto para o `Continuar` não fazer nada — era invisível. Este teste roda
  // o SDK de verdade, sob o header de verdade, e cobra a etapa exata em que o
  // fluxo morria calado: chegar ao `createCardToken`.
  const trace = [];
  page.on('console', message => {
    const text = message.text();
    if (text.includes('[PedeAqui][CartaoSalvo]')) trace.push(text);
  });

  const mpCalls = [];
  await page.route('**/api.mercadopago.com/**', async route => {
    const request = route.request();
    const response = await route.fetch();
    mpCalls.push(`${request.method()} ${new URL(request.url()).pathname}`);
    await route.fulfill({ response });
  });

  const csp = await underProductionCsp(page);
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

  const card = {
    id: '11111111-1111-4111-8111-111111111111',
    provider_card_id: '1562188766181',
    brand: 'visa', last_four_digits: '2508',
    expiration_month: 12, expiration_year: 2030, created_at: '2026-08-25T12:00:00Z'
  };
  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({ balance: 0, transactions: [] })));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json({
    id: 'customer-live-sdk', name: 'Cliente Teste', phone: '85999999999', email: 'cliente@example.com'
  })));
  await page.route('**/payment-config', route => route.fulfill(json({
    provider: 'mercadopago', public_key: publicKey, card_enabled: true
  })));
  await page.route('**/customers/me/cards**', route => route.fulfill(json([card])));

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('.payment-saved-card-select').click();
  await expect(page.locator('#cartPaymentLabel')).toHaveText(/Visa/);
  await page.locator('#cartCtaBtn').click();
  await page.locator('#orderConfirmCta').click();
  await expect(page.locator('#savedCardCvvModal')).toHaveClass(/active/);

  // O campo precisa MONTAR: enquanto ele não monta, o Continuar fica desabilitado
  // e um clique nele não produz erro nenhum — foi esse silêncio que escondeu o bug.
  await expect(page.locator('#mpSavedCardSecurityCode iframe')).toHaveCount(1);
  await expect(page.locator('#confirmSavedCardCvvButton')).toBeEnabled();

  await page.locator('#mpSavedCardSecurityCode').click();
  await page.keyboard.type('123', { delay: 60 });
  await page.locator('#confirmSavedCardCvvButton').click();

  await expect
    .poll(() => mpCalls.filter(call => call.includes('card_tokens')).length, { timeout: 20_000 })
    .toBeGreaterThan(0);

  // A trilha tem que atravessar as cinco etapas sem parar no meio.
  const passos = trace.join(' | ');
  expect(passos, `trilha do CVV:\n${trace.join('\n')}`).toContain('4/5 chamando createCardToken');
  expect(passos, 'o fluxo parou antes de chegar ao Mercado Pago').not.toContain('PAROU');

  const violations = await csp.collect();
  expect(violations, `violacoes de CSP:\n${violations.join('\n')}`).toEqual([]);
});
