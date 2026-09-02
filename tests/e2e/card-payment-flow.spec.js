import { test, expect } from '@playwright/test';
import { mockApi, addH2OToCart, pixOrder, seedOnlineCardBranch, RESTAURANT_URL, SLUG, BRANCH_MATRIZ, esperarAppPronto, validadeFutura } from './helpers.js';

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

async function seedLoggedDelivery(page) {
  await page.addInitScript(({ slug, branchId }) => {
    const address = {
      street: 'Rua Andrade Furtado',
      number: '955',
      complement: 'Ao 1802 bloco LUZ',
      neighborhood: 'Cocó',
      city: 'Fortaleza',
      state: 'Ceará',
      postal_code: '60190090',
      summary: 'Rua Andrade Furtado, 955 - Cocó'
    };
    localStorage.setItem('rapidex.customer.token', 'e2e-card-token');
    localStorage.setItem('rapidex.customer.profile', JSON.stringify({
      id: 'customer-e2e',
      name: 'Cliente Teste',
      phone: '85999999999',
      email: 'cliente.e2e@example.com'
    }));
    localStorage.setItem('rapidex.customerAddress', JSON.stringify(address));
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: 'delivery',
      branch_id: branchId,
      branch_label: 'Matriz',
      address,
      confirmed: true
    }));
  }, { slug: SLUG, branchId: BRANCH_MATRIZ });
}

async function installMercadoPagoSecureFieldsMock(page) {
  await page.addInitScript(() => {
    window.__mpPublicKeys = [];
    window.__mpSecureFields = {};
    const digits = value => String(value || '').replace(/\D/g, '');
    const luhnValid = value => {
      const numbers = digits(value).split('').reverse().map(Number);
      if (numbers.length < 9) return false;
      const sum = numbers.reduce((total, number, index) => {
        if (index % 2 === 0) return total + number;
        const doubled = number * 2;
        return total + (doubled > 9 ? doubled - 9 : doubled);
      }, 0);
      return sum % 10 === 0;
    };
    const fieldErrors = (type, value) => {
      const clean = digits(value);
      if (type === 'cardNumber') {
        return luhnValid(clean) ? [] : [{ cause: clean.length ? 'invalid_value' : 'invalid_length' }];
      }
      if (type === 'expirationDate') {
        const match = String(value || '').match(/^(\d{2})\/(\d{2})$/);
        if (!match) return [{ cause: 'invalid_length' }];
        const month = Number(match[1]);
        const year = 2000 + Number(match[2]);
        const now = new Date();
        const future = month >= 1 && month <= 12
          && (year > now.getFullYear() || (year === now.getFullYear() && month > now.getMonth() + 1));
        return future ? [] : [{ cause: 'invalid_value' }];
      }
      const cardNumber = digits(window.__mpSecureFields.cardNumber?.input?.value);
      const expectedLength = /^(34|37)/.test(cardNumber) ? 4 : 3;
      return clean.length === expectedLength ? [] : [{ cause: 'invalid_length' }];
    };
    class SecureField {
      constructor(type) {
        this.type = type;
        this.input = null;
        this.listeners = {};
      }
      on(event, callback) {
        this.listeners[event] = callback;
        return this;
      }
      mount(containerId) {
        const host = document.getElementById(containerId);
        const input = document.createElement('input');
        input.dataset.secureField = this.type;
        input.setAttribute('aria-label', this.type);
        host.appendChild(input);
        this.input = input;
        window.__mpSecureFields[this.type] = this;
        input.addEventListener('input', () => {
          this.listeners.change?.({ field: this.type });
          this.listeners.validityChange?.({
            field: this.type,
            errorMessages: fieldErrors(this.type, input.value)
          });
        });
        input.addEventListener('blur', () => this.listeners.blur?.({ field: this.type }));
        queueMicrotask(() => this.listeners.ready?.({ field: this.type }));
        return this;
      }
      unmount() {
        this.input?.remove();
        delete window.__mpSecureFields[this.type];
      }
    }
    window.MercadoPago = class {
      constructor(publicKey) {
        window.__mpPublicKeys.push(publicKey);
        this.fields = {
          create: type => new SecureField(type),
          createCardToken: async data => {
            const values = Object.fromEntries(
              [...document.querySelectorAll('[data-secure-field]')]
                .map(input => [input.dataset.secureField, input.value])
            );
            // O gateway recusa qualquer card_id que não seja o id do cartão
            // DENTRO da conta dele — um UUID nosso volta
            // 400 {"message":"invalid card_id","cause":[{"code":"E201"}]}.
            // O mock imita essa recusa: sem isso ele aceitava o UUID errado e
            // o teste passava enquanto a tela real quebrava.
            if (data.cardId !== undefined && !/^\d+$/.test(String(data.cardId))) {
              throw new Error('invalid card_id');
            }
            if (data.cardId ? !values.securityCode : (!values.cardNumber || !values.expirationDate || !values.securityCode)) {
              throw new Error('Campos seguros incompletos');
            }
            window.__mpTokenNonPciData = data;
            return { id: 'tok_test_secure_fields_123' };
          }
        };
      }
    };
  });
}

test('lista → cadastrar → formulário Secure Fields → salvar → sacola selecionada', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await mockApi(page);
  await seedLoggedDelivery(page);
  await seedOnlineCardBranch(page);
  await installMercadoPagoSecureFieldsMock(page);

  const savedCards = [{
    id: '11111111-1111-4111-8111-111111111111',
    provider_card_id: '1562188766181',
    brand: 'visa',
    last_four_digits: '2508',
    expiration_month: 12,
    expiration_year: 2030,
    created_at: '2026-08-25T12:00:00Z'
  }];
  const cardRequests = [];
  const deletedCardIds = [];

  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({
    balance: 0,
    transactions: []
  })));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json({
    id: 'customer-e2e',
    name: 'Cliente Teste',
    phone: '85999999999',
    email: 'cliente.e2e@example.com'
  })));
  await page.route('**/payment-config', route => route.fulfill(json({
    provider: 'mercadopago',
    public_key: 'APP_USR-e2e-public-key',
    card_enabled: true
  })));
  await page.route('**/customers/me/cards**', route => {
    const request = route.request();
    if (request.method() === 'DELETE') {
      const cardId = new URL(request.url()).pathname.split('/').at(-1);
      deletedCardIds.push(cardId);
      const index = savedCards.findIndex(card => card.id === cardId);
      if (index >= 0) savedCards.splice(index, 1);
      return route.fulfill({ status: 204 });
    }
    if (request.method() === 'GET') return route.fulfill(json(savedCards));
    if (request.method() === 'POST') {
      const body = JSON.parse(request.postData() || '{}');
      cardRequests.push(body);
      const card = {
        id: '22222222-2222-4222-8222-222222222222',
        provider_card_id: '1562188766182',
        brand: 'master',
        last_four_digits: '1111',
        expiration_month: 11,
        expiration_year: 2031,
        created_at: '2026-08-25T13:00:00Z'
      };
      savedCards.unshift(card);
      return route.fulfill(json(card, 201));
    }
    return route.fulfill(json({ detail: 'Método não permitido' }, 405));
  });

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();

  const onlinePanel = page.locator('[data-payment-screen-panel="online"]');
  await expect(onlinePanel.locator('[data-payment-key="pix"]')).toBeVisible();
  await expect(page.locator('.payment-saved-card')).toHaveCount(1);
  await expect(page.locator('.payment-saved-card-copy strong')).toHaveText('Visa - Crédito');
  await expect(page.locator('.payment-saved-card-copy small')).toHaveText('•••• •••• •••• 2508');

  await page.locator('.payment-saved-card-delete').click();
  await expect(page.locator('.payment-saved-card')).toHaveCount(0);
  expect(deletedCardIds).toEqual(['11111111-1111-4111-8111-111111111111']);

  await page.locator('#paymentAddCard').click();
  await expect(page.locator('#addCardTypeModal')).toHaveClass(/active/);
  await page.locator('#addCreditCardOption').click();
  await expect(page.locator('#creditCardModal')).toHaveClass(/active/);
  await expect(page.locator('#creditCardModal')).not.toContainText('Carregando...');
  await expect(page.locator('#creditCardModal .payment-secure-field.is-loading')).toHaveCount(0);
  await expect(page.locator('[data-secure-field="cardNumber"]')).toBeVisible();
  await expect(page.locator('#creditCardModal .payment-card-screen')).toHaveCSS('background-color', 'rgb(247, 245, 243)');
  await expect(page.locator('#creditCardModal .payment-card-header')).toHaveCSS('background-color', 'rgb(255, 255, 255)');

  await page.locator('[data-secure-field="cardNumber"]').click();
  await page.keyboard.type('5031433215406351');
  await page.locator('[data-secure-field="expirationDate"]').click();
  await page.keyboard.type(validadeFutura());
  await page.locator('[data-secure-field="securityCode"]').click();
  await page.keyboard.type('123');
  await page.locator('#cardholderName').fill('APRO');
  await page.locator('#cardholderCpf').fill('12345678909');
  await expect(page.locator('#cardholderName, #cardholderCpf')).toHaveCount(2);
  await expect(page.locator('.billing-address-section')).toHaveCount(0);

  await page.locator('#saveCreditCardButton').click();
  await expect(page.locator('#creditCardModal')).not.toHaveClass(/active/);
  await expect(page.locator('#paymentMethodModal')).not.toHaveClass(/active/);
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await expect(page.locator('#cartPaymentLabel')).toHaveText('Crédito - Mastercard •••• 1111');

  expect(cardRequests).toEqual([{
    restaurant_slug: SLUG,
    token: 'tok_test_secure_fields_123'
  }]);
  expect(JSON.stringify(cardRequests)).not.toContain('5031433215406351');
  expect(JSON.stringify(cardRequests)).not.toContain('12345678909');
  expect(await page.evaluate(() => window.__mpPublicKeys)).toEqual(['APP_USR-e2e-public-key']);
  expect(await page.evaluate(() => window.__mpTokenNonPciData)).toEqual({
    cardholderName: 'APRO',
    identificationType: 'CPF',
    identificationNumber: '12345678909'
  });
});

test('Salvar fica ativo e mostra cada erro no campo correto com o visual do cadastro', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await seedLoggedDelivery(page);
  await seedOnlineCardBranch(page);
  await installMercadoPagoSecureFieldsMock(page);
  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({ balance: 0, transactions: [] })));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json({
    id: 'customer-e2e', name: 'Cliente Teste', phone: '85999999999', email: 'cliente.e2e@example.com'
  })));
  await page.route('**/payment-config', route => route.fulfill(json({
    provider: 'mercadopago', public_key: 'APP_USR-e2e-public-key', card_enabled: true
  })));
  await page.route('**/customers/me/cards**', route => route.fulfill(json([])));

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('#paymentAddCard').click();
  await page.locator('#addCreditCardOption').click();

  const save = page.locator('#saveCreditCardButton');
  await expect(save).toBeEnabled();
  await expect(save).toHaveCSS('opacity', '1');
  await save.click();
  await expect(page.locator('#cardNumberError')).toHaveText('Campo obrigatório');
  await expect(page.locator('#expirationDateError')).toHaveText('Campo obrigatório');
  await expect(page.locator('#securityCodeError')).toHaveText('Campo obrigatório');
  await expect(page.locator('#cardholderCpfError')).toHaveText('Campo obrigatório');

  await page.locator('[data-secure-field="cardNumber"]').fill('5031433215406352');
  await page.locator('[data-secure-field="expirationDate"]').fill('01/20');
  await page.locator('[data-secure-field="securityCode"]').fill('12');
  await page.locator('#cardholderName').fill('APRO');
  await page.locator('#cardholderCpf').fill('12345678900');
  await save.click();

  await expect(page.locator('#cardNumberError')).toHaveText('Número do cartão inválido');
  await expect(page.locator('#expirationDateError')).toHaveText('Informe uma data de validade futura');
  await expect(page.locator('#securityCodeError')).toHaveText('CVV inválido para a bandeira do cartão');
  await expect(page.locator('#cardholderCpfError')).toHaveText('CPF inválido');
  await expect(page.locator('#cardNumberError')).toHaveCSS('color', 'rgb(238, 138, 138)');
  await expect(page.locator('#cardNumberError')).toHaveCSS('font-size', '11px');
  await expect(page.locator('#mpCardNumber')).toHaveCSS('border-bottom-color', 'rgb(239, 90, 90)');
});

async function runSavedCardCheckout(page, paymentStatus) {
  const paymentBodies = [];
  const paymentAuth = [];
  const api = await mockApi(page, {
    orderResponse: () => pixOrder(1),
    onStartPayment: (route, request) => {
      paymentBodies.push(JSON.parse(request.postData() || '{}'));
      paymentAuth.push(request.headers().authorization || null);
      return route.fulfill(json({
        provider: 'mercadopago',
        provider_payment_id: 'card-payment-e2e',
        payment_status: paymentStatus
      }));
    }
  });
  await seedLoggedDelivery(page);
  await seedOnlineCardBranch(page);
  await installMercadoPagoSecureFieldsMock(page);
  const card = {
    id: '11111111-1111-4111-8111-111111111111',
    provider_card_id: '1562188766181',
    brand: 'visa',
    last_four_digits: '2508',
    expiration_month: 12,
    expiration_year: 2030,
    created_at: '2026-08-25T12:00:00Z'
  };
  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({ balance: 0, transactions: [] })));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json({
    id: 'customer-e2e', name: 'Cliente Teste', phone: '85999999999', email: 'cliente.e2e@example.com'
  })));
  await page.route('**/payment-config', route => route.fulfill(json({
    provider: 'mercadopago', public_key: 'APP_USR-e2e-public-key', card_enabled: true
  })));
  await page.route('**/customers/me/cards**', route => route.fulfill(json([card])));

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('.payment-saved-card-select').click();
  await expect(page.locator('#cartPaymentLabel')).toHaveText('Crédito - Visa •••• 2508');
  await page.locator('#cartCtaBtn').click();
  await page.locator('#orderConfirmCta').click();
  await expect(page.locator('#savedCardCvvModal')).toHaveClass(/active/);
  await page.locator('[data-secure-field="securityCode"]').fill('123');
  await page.locator('#confirmSavedCardCvvButton').click();
  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/);
  await expect(page.locator('#pixPaymentModal')).not.toHaveClass(/active/);

  expect(api.orderRequests).toHaveLength(1);
  expect(api.orderRequests[0].body.payment_method).toBe('credit_card');

  // O Bearer do cliente NA COBRANÇA. O tracking token do path autoriza a rota,
  // mas o backend só cobra no cartão com cliente autenticado — sem este header
  // a resposta é 401 `login_required`, com CVV certo ou errado, e o pedido fica
  // criado sem pagamento. Este expect é o que impede a regressão de voltar.
  expect(paymentAuth).toEqual(['Bearer e2e-card-token']);
  expect(paymentBodies).toEqual([{
    card: {
      saved_card_id: card.id,
      token: 'tok_test_secure_fields_123'
    }
  }]);

  // Os DOIS ids, cada um no seu lugar: o nosso UUID vai no corpo do pagamento
  // (`saved_card_id`), e o id do cartão na conta do Mercado Pago é o que
  // tokeniza (`cardId`). Trocá-los é o bug que derrubava a tela de CVV.
  const tokenData = await page.evaluate(() => window.__mpTokenNonPciData);
  expect(tokenData).toEqual({ cardId: card.provider_card_id });
  expect(tokenData.cardId).not.toBe(card.id);
}

test('checkout com cartão salvo pede CVV e conclui o pagamento', async ({ page }) => {
  await runSavedCardCheckout(page, 'paid');
});

test('cartão em análise conclui sem abrir a tela de Pix', async ({ page }) => {
  await runSavedCardCheckout(page, 'in_review');
});

test('card_enabled falso não desenha cartão nem inicializa o SDK', async ({ page }) => {
  await mockApi(page);
  await seedLoggedDelivery(page);
  await seedOnlineCardBranch(page);
  await installMercadoPagoSecureFieldsMock(page);
  await page.route('**/payment-config', route => route.fulfill(json({
    provider: 'mercadopago',
    public_key: null,
    card_enabled: false
  })));
  await page.route('**/customers/me', route => route.fulfill(json({
    id: 'customer-e2e', name: 'Cliente Teste', email: 'cliente.e2e@example.com'
  })));

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.RapidexActions.resolve('openPaymentMethodScreen')());

  await expect(page.locator('#paymentOnlineCards')).toBeHidden();
  expect(await page.evaluate(() => window.__mpPublicKeys)).toEqual([]);
});

/**
 * O MESMO checkout de cartão salvo, mas com a cobrança RECUSADA.
 *
 * `onStartPayment` decide o que a rota de cobrança responde; o resto do
 * caminho é idêntico ao do sucesso, inclusive os cliques. É isso que torna a
 * comparação honesta: a única variável é a resposta do gateway.
 */
async function runDeclinedSavedCardCheckout(page, onStartPayment) {
  const api = await mockApi(page, { orderResponse: () => pixOrder(1), onStartPayment });
  await seedLoggedDelivery(page);
  await seedOnlineCardBranch(page);
  await installMercadoPagoSecureFieldsMock(page);
  const card = {
    id: '11111111-1111-4111-8111-111111111111',
    provider_card_id: '1562188766181',
    brand: 'visa',
    last_four_digits: '2508',
    expiration_month: 12,
    expiration_year: 2030,
    created_at: '2026-08-25T12:00:00Z'
  };
  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({ balance: 0, transactions: [] })));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json({
    id: 'customer-e2e', name: 'Cliente Teste', phone: '85999999999', email: 'cliente.e2e@example.com'
  })));
  await page.route('**/payment-config', route => route.fulfill(json({
    provider: 'mercadopago', public_key: 'APP_USR-e2e-public-key', card_enabled: true
  })));
  await page.route('**/customers/me/cards**', route => route.fulfill(json([card])));

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('.payment-saved-card-select').click();
  await expect(page.locator('#cartPaymentLabel')).toHaveText('Crédito - Visa •••• 2508');
  await page.locator('#cartCtaBtn').click();
  await page.locator('#orderConfirmCta').click();
  await expect(page.locator('#savedCardCvvModal')).toHaveClass(/active/);
  await page.locator('[data-secure-field="securityCode"]').fill('123');
  await page.locator('#confirmSavedCardCvvButton').click();

  // O desfecho da recusa: a sacola, com o motivo escrito nela.
  await expect(page.locator('#cartOrderError')).toBeVisible();
  return api;
}

/** O que NUNCA pode aparecer depois de uma recusa. */
async function expectNoOrderPlaced(page) {
  await expect(page.locator('#orderSuccessModal')).not.toHaveClass(/active/);
  await expect(page.locator('#pixPaymentModal')).not.toHaveClass(/active/);
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await expect(page.locator('#orderConfirmSheet')).not.toHaveClass(/is-open/);
  // A sacola INTACTA: recusa não pode custar os itens do cliente.
  const stored = await page.evaluate(() => {
    const key = Object.keys(localStorage).find(name => name.startsWith('rapidex.cart.'));
    return key ? JSON.parse(localStorage.getItem(key)).items.length : 0;
  });
  expect(stored).toBe(1);
}

test('cartão recusado não vira pedido feito: erro na sacola, com a frase do gateway', async ({ page }) => {
  await runDeclinedSavedCardCheckout(page, route => route.fulfill(json({
    provider: 'mercadopago',
    provider_payment_id: 'card-payment-e2e',
    payment_status: 'rejected',
    message: 'Confira o código de segurança do cartão.'
  })));

  await expect(page.locator('#cartOrderError')).toHaveText('Confira o código de segurança do cartão.');
  await expectNoOrderPlaced(page);
});

/**
 * O buraco que deixava um CVV errado virar "pedido feito".
 *
 * No Pix, status desconhecido quer dizer "ainda vai ser pago" e o polling
 * continua. No CARTÃO não existe esperar: a autorização é síncrona. Estes dois
 * casos travam a regra de que, no cartão, tudo o que não é aprovação explícita
 * é NÃO PAGO — inclusive `pending`, inclusive resposta sem status nenhum.
 */
for (const [label, body] of [
  ['pending', { payment_status: 'pending' }],
  ['sem payment_status', {}]
]) {
  test(`cobrança de cartão com status "${label}" não confirma o pedido`, async ({ page }) => {
    await runDeclinedSavedCardCheckout(page, route => route.fulfill(json({
      provider: 'mercadopago', provider_payment_id: 'card-payment-e2e', ...body
    })));

    await expect(page.locator('#cartOrderError'))
      .toHaveText(/Pagamento não aprovado pelo cartão/);
    await expectNoOrderPlaced(page);
  });
}

test('falha da rota de cobrança no cartão volta para a sacola, não para a tela do Pix', async ({ page }) => {
  await runDeclinedSavedCardCheckout(page, route => route.fulfill(json({
    detail: { code: 'cc_rejected_bad_filled_security_code', retryable: false, message: 'Confira o código de segurança do cartão.' }
  }, 400)));

  await expect(page.locator('#cartOrderError')).toHaveText('Confira o código de segurança do cartão.');
  await expectNoOrderPlaced(page);
});

test('depois da recusa, tentar de novo pede o CVV outra vez em vez de reabrir o Pix', async ({ page }) => {
  const api = await runDeclinedSavedCardCheckout(page, route => route.fulfill(json({
    provider: 'mercadopago', provider_payment_id: 'card-payment-e2e', payment_status: 'rejected'
  })));
  expect(api.orderRequests).toHaveLength(1);

  await page.locator('#cartCtaBtn').click();
  await page.locator('#orderConfirmCta').click();

  // O token do Mercado Pago é de uso único: sem pedir o CVV de novo, a
  // retentativa só repetiria a mesma recusa. E nada de tela de Pix — a
  // cobrança recusada não é uma cobrança pendente para retomar.
  await expect(page.locator('#savedCardCvvModal')).toHaveClass(/active/);
  await expect(page.locator('#pixPaymentModal')).not.toHaveClass(/active/);
});

test('recusa por CVV vira a frase do CVV, e não a genérica — status_detail é lido', async ({ page }) => {
  await runDeclinedSavedCardCheckout(page, route => route.fulfill(json({
    provider: 'mercadopago',
    provider_payment_id: 'card-payment-e2e',
    payment_status: 'failed',
    // O motivo cru do Mercado Pago. É a ÚNICA pista do que pedir ao cliente:
    // StartPaymentResponse não tem campo de mensagem numa recusa.
    status_detail: 'cc_rejected_bad_filled_security_code'
  })));

  await expect(page.locator('#cartOrderError'))
    .toHaveText('Código de segurança incorreto. Confira o CVV do cartão e tente de novo.');
  await expectNoOrderPlaced(page);
});

test('recusa por limite pede outro cartão, não que o CVV seja redigitado', async ({ page }) => {
  await runDeclinedSavedCardCheckout(page, route => route.fulfill(json({
    provider: 'mercadopago',
    provider_payment_id: 'card-payment-e2e',
    payment_status: 'failed',
    status_detail: 'cc_rejected_insufficient_amount'
  })));

  await expect(page.locator('#cartOrderError')).toHaveText(/não tem limite suficiente/);
  await expectNoOrderPlaced(page);
});

test('status_detail desconhecido cai na frase genérica, nunca num palpite errado', async ({ page }) => {
  await runDeclinedSavedCardCheckout(page, route => route.fulfill(json({
    provider: 'mercadopago',
    provider_payment_id: 'card-payment-e2e',
    payment_status: 'failed',
    status_detail: 'cc_rejected_motivo_que_ainda_nao_existe'
  })));

  await expect(page.locator('#cartOrderError')).toHaveText(/Pagamento não aprovado pelo cartão/);
  await expectNoOrderPlaced(page);
});

test('401 login_required não vira "pedido feito": mostra a frase do backend na sacola', async ({ page }) => {
  await runDeclinedSavedCardCheckout(page, route => route.fulfill(json({
    detail: {
      code: 'login_required',
      retryable: false,
      message: 'Para pagar com cartão é preciso entrar na sua conta. Você também pode pagar com Pix ou na entrega.'
    }
  }, 401)));

  await expect(page.locator('#cartOrderError')).toHaveText(/preciso entrar na sua conta/);
  await expectNoOrderPlaced(page);
});

/**
 * A FILIAL MANDA, e é ela que decide o `payment_flow`.
 *
 * `/payment-config` diz que o RESTAURANTE tem credencial de gateway.
 * `/info` diz que ESTA FILIAL habilitou `credit_card` como online. O front só
 * conferia a primeira, e com `credit_card` habilitado apenas como `delivery`
 * — a maquininha — o cliente escolhia o cartão salvo, digitava o CVV, o token
 * era gerado, e o pedido nascia `payment_flow: "delivery"` sem cobrança
 * nenhuma. O fixture de /info é cópia da produção e já continha o caso.
 */
async function seedCardBranchScenario(page, { onlineCard }) {
  const api = await mockApi(page, { orderResponse: () => pixOrder(1) });
  await seedLoggedDelivery(page);
  if (onlineCard) await seedOnlineCardBranch(page);
  await installMercadoPagoSecureFieldsMock(page);
  const card = {
    id: '11111111-1111-4111-8111-111111111111',
    provider_card_id: '1562188766181',
    brand: 'visa',
    last_four_digits: '2508',
    expiration_month: 12,
    expiration_year: 2030,
    created_at: '2026-08-25T12:00:00Z'
  };
  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({ balance: 0, transactions: [] })));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json({
    id: 'customer-e2e', name: 'Cliente Teste', phone: '85999999999', email: 'cliente.e2e@example.com'
  })));
  await page.route('**/payment-config', route => route.fulfill(json({
    provider: 'mercadopago', public_key: 'APP_USR-e2e-public-key', card_enabled: true
  })));
  await page.route('**/customers/me/cards**', route => route.fulfill(json([card])));

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  return api;
}

test('filial que só aceita cartão na maquininha não oferece cartão online', async ({ page }) => {
  await seedCardBranchScenario(page, { onlineCard: false });

  // O PIX continua lá — ele está em `online` no fixture; o cartão, não.
  await expect(page.locator('[data-payment-screen-panel="online"] [data-payment-key="pix"]')).toBeVisible();
  await expect(page.locator('#paymentOnlineCards')).toBeHidden();
  await expect(page.locator('.payment-saved-card')).toHaveCount(0);

  // "Crédito" segue OFERECIDO — como pagamento NA ENTREGA, que é o que a
  // filial de fato aceita (o painel só não é o que está na frente). O que não
  // pode existir é a versão online.
  await expect(page.locator('[data-payment-delivery-group="credit"] .payment-method-option'))
    .not.toHaveCount(0);
});

test('a mesma filial COM credit_card online volta a oferecer o cartão salvo', async ({ page }) => {
  await seedCardBranchScenario(page, { onlineCard: true });

  await expect(page.locator('#paymentOnlineCards')).toBeVisible();
  await expect(page.locator('.payment-saved-card')).toHaveCount(1);
  await expect(page.locator('.payment-saved-card-copy strong')).toHaveText('Visa - Crédito');
});

test('o pedido nunca sai com credit_card numa filial que não cobra cartão online', async ({ page }) => {
  const api = await seedCardBranchScenario(page, { onlineCard: false });

  // Sem cartão oferecido, o cliente fecha por PIX — e o pedido tem que sair
  // com o método que a filial aceita, não com o que a UI deixou pendurado.
  await page.locator('[data-payment-screen-panel="online"] [data-payment-key="pix"]').click();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#cartPaymentLabel')).toHaveText('PIX');
  await page.locator('#cartCtaBtn').click();
  await page.locator('#orderConfirmCta').click();
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);

  expect(api.orderRequests).toHaveLength(1);
  expect(api.orderRequests[0].body.payment_method).toBe('pix');
});

test('pedido de cartão que volta payment_flow=delivery avisa que o cartão NÃO foi cobrado', async ({ page }) => {
  // A divergência que não deve acontecer com a gate no lugar: /info diz que a
  // filial aceita cartão online, mas a criação do pedido devolve "delivery".
  // Se acontecer, "pedido feito" sem mais nada leria como "cartão cobrado".
  const paymentCalls = [];
  await mockApi(page, {
    orderResponse: () => pixOrder(1, { payment_flow: 'delivery', payment_status: 'on_delivery' }),
    onStartPayment: (route) => { paymentCalls.push(1); return route.fulfill(json({})); }
  });
  await seedLoggedDelivery(page);
  await seedOnlineCardBranch(page);
  await installMercadoPagoSecureFieldsMock(page);
  const card = {
    id: '11111111-1111-4111-8111-111111111111', provider_card_id: '1562188766181',
    brand: 'visa', last_four_digits: '2508', expiration_month: 12, expiration_year: 2030,
    created_at: '2026-08-25T12:00:00Z'
  };
  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({ balance: 0, transactions: [] })));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json({
    id: 'customer-e2e', name: 'Cliente Teste', phone: '85999999999'
  })));
  await page.route('**/payment-config', route => route.fulfill(json({
    provider: 'mercadopago', public_key: 'APP_USR-e2e-public-key', card_enabled: true
  })));
  await page.route('**/customers/me/cards**', route => route.fulfill(json([card])));

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('.payment-saved-card-select').click();
  await page.locator('#cartCtaBtn').click();
  await page.locator('#orderConfirmCta').click();
  await expect(page.locator('#savedCardCvvModal')).toHaveClass(/active/);
  await page.locator('[data-secure-field="securityCode"]').fill('123');
  await page.locator('#confirmSavedCardCvvButton').click();

  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/);
  await expect(page.locator('#ordSuccessMessage')).toHaveText(/o cartão não foi cobrado/i);
  // Nenhuma cobrança foi tentada: não havia fluxo online para cobrar.
  expect(paymentCalls).toHaveLength(0);
});

// ============================================================================
//  AS DUAS ESCRITAS DE CARTÃO QUE SÓ TINHAM CAMINHO FELIZ.
//
//  Medido em 02/09/2026: TODO mock de `/customers/me/cards` da suíte devolvia
//  200. Salvar cartão e remover cartão nunca tinham falhado num teste — e as
//  duas rotas declaram falha no contrato:
//
//    POST   /customers/me/cards            201, 401, 409, 422, 502, 503
//    DELETE /customers/me/cards/{card_id}  200, 401, 404, 422, 502
//
//  O que cada uma protege é diferente, e as duas são dinheiro:
//
//  - SALVAR que falha não pode deixar o cartão na lista. Um cartão que a tela
//    mostra e o gateway não tem é um cartão que o cliente escolhe no checkout e
//    que recusa na hora de pagar — com a sacola montada e a fome no lugar.
//  - REMOVER que falha PRECISA deixar o cartão na lista. É o próprio contrato
//    que diz: com 502 "a remoção falha inteira e o cartão continua na lista — o
//    cliente tenta de novo". Sumir com ele da tela faria a pessoa acreditar que
//    apagou um cartão que continua na conta do lojista.
// ============================================================================

/** A tela do formulário de cartão, com a lista de cartões que o teste mandar. */
async function abrirFormularioDeCartao(page, { cartoes = [], onSaveCard = null } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await seedLoggedDelivery(page);
  await seedOnlineCardBranch(page);
  await installMercadoPagoSecureFieldsMock(page);
  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({ balance: 0, transactions: [] })));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json({
    id: 'customer-e2e', name: 'Cliente Teste', phone: '85999999999', email: 'cliente.e2e@example.com'
  })));
  await page.route('**/payment-config', route => route.fulfill(json({
    provider: 'mercadopago', public_key: 'APP_USR-e2e-public-key', card_enabled: true
  })));
  const chamadas = [];
  await page.route('**/customers/me/cards**', route => {
    const metodo = route.request().method();
    chamadas.push({ metodo, url: route.request().url() });
    if (metodo === 'GET') return route.fulfill(json(cartoes));
    if (metodo === 'POST' && onSaveCard) return onSaveCard(route);
    if (metodo === 'DELETE') return route.fulfill(json({ ok: true }));
    return route.fulfill(json({ id: 'card-novo' }, 201));
  });

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  return chamadas;
}

test('salvar cartão que o backend RECUSA não coloca o cartão na lista', async ({ page }) => {
  // 409 é uma das falhas que o contrato declara para esta rota. O ponto não é
  // o número: é que uma falha qualquer não pode virar um cartão na tela.
  await abrirFormularioDeCartao(page, {
    onSaveCard: route => route.fulfill(json({ detail: 'Cartão já cadastrado nesta conta.' }, 409))
  });

  await page.locator('#paymentAddCard').click();
  await page.locator('#addCreditCardOption').click();
  // 5031433215406351 passa no Luhn. O ...352 do teste vizinho e invalido DE
  // PROPOSITO — copiar de la sem conferir fez o formulario parar na validacao e
  // o POST nunca sair, com o erro de tela vazio.
  await page.locator('[data-secure-field="cardNumber"]').fill('5031433215406351');
  await page.locator('[data-secure-field="expirationDate"]').fill(validadeFutura());
  await page.locator('[data-secure-field="securityCode"]').fill('123');
  await page.locator('#cardholderName').fill('APRO');
  // 52998224725 passa no validador de CPF. O 12345678900 do teste vizinho e
  // INVALIDO de proposito — com ele o formulario para na validacao e o POST
  // nunca sai, e o erro de tela fica vazio em vez de trazer a frase do backend.
  await page.locator('#cardholderCpf').fill('52998224725');
  await page.locator('#saveCreditCardButton').click();

  // A mensagem do BACKEND chega ao cliente. Uma frase genérica nossa esconderia
  // a única informação acionável ("já cadastrado" vs "tente de novo").
  await expect(page.locator('#creditCardFormError')).toContainText('já cadastrado');

  // O CARTÃO NÃO ENTRA NA LISTA. É o ponto do teste: um cartão que a tela
  // mostra e o gateway não tem recusa no checkout, com a sacola montada.
  await expect(page.locator('.payment-saved-card')).toHaveCount(0);
  // E a tela NÃO fecha: fechar sobre um erro esconde o erro.
  await expect(page.locator('#creditCardModal')).toHaveClass(/active/);
  // O botão volta: sem isto a pessoa fica com um formulário preenchido e morto.
  await expect(page.locator('#saveCreditCardButton')).toBeEnabled();
});

test('remover cartão que falha DEIXA o cartão na lista — o contrato manda', async ({ page }) => {
  const cartao = {
    id: 'card-e2e-1',
    provider_card_id: '1562188766181',
    brand: 'visa',
    last_four_digits: '2508',
    expiration_month: 12,
    expiration_year: 2030,
    created_at: '2026-08-25T12:00:00Z'
  };
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await seedLoggedDelivery(page);
  await seedOnlineCardBranch(page);
  await installMercadoPagoSecureFieldsMock(page);
  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({ balance: 0, transactions: [] })));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json({
    id: 'customer-e2e', name: 'Cliente Teste', phone: '85999999999', email: 'cliente.e2e@example.com'
  })));
  await page.route('**/payment-config', route => route.fulfill(json({
    provider: 'mercadopago', public_key: 'APP_USR-e2e-public-key', card_enabled: true
  })));
  // 502 é o caso que o `@description` da rota descreve: o gateway respondeu
  // primeiro e caiu, então a remoção não aconteceu em lado nenhum.
  // UMA rota so, decidindo pelo metodo. Duas rotas aninhadas nao funcionam
  // aqui: a ultima registrada vence para TODAS as URLs que ela casa, e a
  // generica respondia 200 ao DELETE — o cartao sumia e o teste media o
  // caminho feliz achando que media a falha.
  await page.route('**/customers/me/cards**', route =>
    route.request().method() === 'DELETE'
      ? route.fulfill(json({ detail: 'Gateway indisponível' }, 502))
      : route.fulfill(json([cartao]))
  );

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await expect(page.locator('.payment-saved-card')).toHaveCount(1);

  await page.evaluate((id) => window.RapidexActions.resolve('deleteSavedCard')?.(id), cartao.id);

  // O CARTÃO CONTINUA. "A remoção falha inteira e o cartão continua na lista —
  // o cliente tenta de novo" é o texto do contrato, e é o comportamento certo:
  // sumir com ele faria a pessoa acreditar que apagou o que continua lá.
  await expect(page.locator('.payment-saved-card')).toHaveCount(1);
  await expect(page.locator('#paymentSavedCards')).toContainText(/não foi possível remover|indisponível/i);
});
