import { test, expect } from '@playwright/test';
import { mockApi, addH2OToCart, RESTAURANT_URL, SLUG, BRANCH_MATRIZ, seedOnlineCardBranch } from './helpers.js';

// Enquanto o SDK do Mercado Pago carrega o cliente vê CARREGANDO. Erro só
// quando falha de verdade.
//
// Estes testes usam o SDK REAL da rede de propósito: o mock de
// card-payment-flow.spec.js define window.MercadoPago antes do boot, então lá o
// loadSdk() nunca chega a baixar nada — era justamente por isso que o atraso e
// a falha do download passavam batidos pela suíte inteira. A chave pública é
// inválida (nada é tokenizado aqui); o que está sob teste é o CAMINHO até os
// iframes existirem, que independe de a chave ser boa.

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });
const PUBLIC_KEY = 'TEST-8f1a0c2e-0000-4000-8000-000000000000';

async function seedLoggedDelivery(page) {
  await page.addInitScript(({ slug, branchId }) => {
    const address = {
      street: 'Rua Andrade Furtado', number: '955', neighborhood: 'Cocó',
      city: 'Fortaleza', state: 'Ceará', postal_code: '60190090',
      summary: 'Rua Andrade Furtado, 955 - Cocó'
    };
    localStorage.setItem('rapidex.customer.token', 'e2e-card-token');
    localStorage.setItem('rapidex.customer.profile', JSON.stringify({
      id: 'customer-e2e', name: 'Cliente Teste', phone: '85999999999'
    }));
    localStorage.setItem('rapidex.customerAddress', JSON.stringify(address));
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: 'delivery', branch_id: branchId, branch_label: 'Matriz', address, confirmed: true
    }));
  }, { slug: SLUG, branchId: BRANCH_MATRIZ });
}

async function mockCustomerRoutes(page) {
  // Sem cartao online na filial, o checkout nao desenha a area do cartao.
  await seedOnlineCardBranch(page);
  await page.route('**/payment-config', route => route.fulfill(json({
    provider: 'mercadopago', public_key: PUBLIC_KEY, card_enabled: true
  })));
  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({ balance: 0, transactions: [] })));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json({
    id: 'customer-e2e', name: 'Cliente Teste', phone: '85999999999'
  })));
  await page.route('**/customers/me/cards**', route => route.fulfill(json([])));
}

/** O texto do ::after é o que o cliente lê dentro da caixa do campo seguro. */
const fieldOverlayText = (page, id) => page.evaluate(
  hostId => getComputedStyle(document.getElementById(hostId), '::after').content,
  id
);

async function openPaymentScreen(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('#paymentAddCard').click();
}

test('SDK lento: a tela abre na hora, os campos dizem Carregando e ficam prontos sozinhos', async ({ page }) => {
  test.setTimeout(120_000);
  await mockApi(page);
  await seedLoggedDelivery(page);
  await mockCustomerRoutes(page);
  // 3G ruim. Nesse intervalo inteiro o cliente NÃO pode ler mensagem de erro.
  await page.route('https://sdk.mercadopago.com/**', async (route) => {
    await new Promise(resolve => setTimeout(resolve, 3500));
    return route.continue();
  });

  await openPaymentScreen(page);
  const clickedAt = Date.now();
  await page.locator('#addCreditCardOption').click();

  // A tela não espera SDK nenhum para existir.
  await expect(page.locator('#creditCardModal')).toHaveClass(/active/, { timeout: 2_000 });
  expect(Date.now() - clickedAt).toBeLessThan(2_000);

  await expect(page.locator('#mpCardNumber')).toHaveClass(/is-loading/);
  await expect(page.locator('#mpCardNumber')).toHaveAttribute('aria-busy', 'true');
  expect(await fieldOverlayText(page, 'mpCardNumber')).toContain('Carregando');
  expect(await fieldOverlayText(page, 'mpCardNumber')).not.toContain('indisponível');
  // Nada de erro enquanto está apenas carregando.
  await expect(page.locator('#mpCardNumber')).not.toHaveClass(/has-load-error/);
  await expect(page.locator('#cardNumberError')).toHaveText('');
  await expect(page.locator('#expirationDateError')).toHaveText('');
  await expect(page.locator('#securityCodeError')).toHaveText('');
  await expect(page.locator('#creditCardFormError')).toBeHidden();
  // Salvar não convida a enviar um formulário que ainda não tem como tokenizar.
  await expect(page.locator('#saveCreditCardButton')).toBeDisabled();

  await expect(page.locator('#mpCardNumber')).not.toHaveClass(/is-loading/, { timeout: 60_000 });
  await expect(page.locator('#mpCardNumber iframe')).toHaveCount(1);
  await expect(page.locator('#mpCardNumber')).not.toHaveClass(/has-load-error/);
  await expect(page.locator('#saveCreditCardButton')).toBeEnabled();
});

test('SDK indisponível: erro de verdade, e tentar de novo se recupera sem recarregar', async ({ page }) => {
  test.setTimeout(120_000);
  await mockApi(page);
  await seedLoggedDelivery(page);
  await mockCustomerRoutes(page);
  let offline = true;
  let sdkRequests = 0;
  await page.route('https://sdk.mercadopago.com/**', (route) => {
    sdkRequests += 1;
    return offline ? route.abort('failed') : route.continue();
  });

  await openPaymentScreen(page);
  await page.locator('#addCreditCardOption').click();
  await expect(page.locator('#creditCardModal')).toHaveClass(/active/);
  await expect(page.locator('#creditCardFormError'))
    .toHaveText('Não foi possível carregar a segurança do cartão.', { timeout: 60_000 });
  await expect(page.locator('#mpCardNumber')).toHaveClass(/has-load-error/);
  await expect(page.locator('#mpCardNumber')).not.toHaveClass(/is-loading/);
  expect(await fieldOverlayText(page, 'mpCardNumber')).toContain('indisponível');

  // A rede volta. Uma <script> que já falhou nunca mais dispara `load`, então
  // reaproveitar a tag deixava a promessa pendente para sempre e prendia o
  // cliente no erro até recarregar a página inteira.
  const requestsWhileOffline = sdkRequests;
  offline = false;
  await page.locator('#creditCardModal .payment-card-back').click();
  await page.locator('#addCreditCardOption').click();
  await expect(page.locator('#mpCardNumber iframe')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('#mpCardNumber')).not.toHaveClass(/has-load-error/);
  await expect(page.locator('#creditCardFormError')).toBeHidden();
  expect(sdkRequests).toBeGreaterThan(requestsWhileOffline);
});

test('o SDK é baixado quando a tela de pagamento abre, não no clique em Crédito', async ({ page }) => {
  test.setTimeout(120_000);
  await mockApi(page);
  await seedLoggedDelivery(page);
  await mockCustomerRoutes(page);

  await openPaymentScreen(page);
  // Dois toques antes de "Crédito" o download já está em curso ou concluído.
  await expect.poll(
    () => page.evaluate(() => Boolean(window.MercadoPago)),
    { timeout: 30_000 }
  ).toBe(true);

  await page.locator('#addCreditCardOption').click();
  await expect(page.locator('#mpCardNumber iframe')).toHaveCount(1, { timeout: 60_000 });
  await expect(page.locator('#mpCardNumber')).not.toHaveClass(/is-loading/, { timeout: 60_000 });
  await expect(page.locator('#mpCardNumber')).not.toHaveClass(/has-load-error/);
});
