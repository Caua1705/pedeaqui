import { test, expect } from '@playwright/test';
import { mockApi, addH2OToCart, RESTAURANT_URL, SLUG, BRANCH_MATRIZ } from './helpers.js';

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
    class SecureField {
      constructor(type) {
        this.type = type;
        this.input = null;
      }
      mount(containerId) {
        const host = document.getElementById(containerId);
        const input = document.createElement('input');
        input.dataset.secureField = this.type;
        input.setAttribute('aria-label', this.type);
        host.appendChild(input);
        this.input = input;
        return this;
      }
      unmount() {
        this.input?.remove();
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
            if (!values.cardNumber || !values.expirationDate || !values.securityCode) {
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
  await mockApi(page);
  await seedLoggedDelivery(page);
  await installMercadoPagoSecureFieldsMock(page);

  const savedCards = [{
    id: '11111111-1111-4111-8111-111111111111',
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
  await expect(page.locator('[data-secure-field="cardNumber"]')).toBeVisible();

  await page.locator('[data-secure-field="cardNumber"]').fill('5031433215406351');
  await page.locator('[data-secure-field="expirationDate"]').fill('11/31');
  await page.locator('[data-secure-field="securityCode"]').fill('123');
  await page.locator('#cardholderName').fill('APRO');
  await page.locator('#cardholderCpf').fill('12345678909');
  await page.locator('.billing-copy-address').click();
  await expect(page.locator('#copyDeliveryAddress')).toBeChecked();

  await expect(page.locator('#billingPostalCode')).toHaveValue('60190-090');
  await expect(page.locator('#billingStreet')).toHaveValue('Rua Andrade Furtado');
  await expect(page.locator('#billingNumber')).toHaveValue('955');
  await expect(page.locator('#billingComplement')).toHaveValue('Ao 1802 bloco LUZ');
  await expect(page.locator('#billingNeighborhood')).toHaveValue('Cocó');
  await expect(page.locator('#billingCity')).toHaveValue('Fortaleza');
  await expect(page.locator('#billingState')).toHaveValue('Ceará');

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

test('card_enabled falso não desenha cartão nem inicializa o SDK', async ({ page }) => {
  await mockApi(page);
  await seedLoggedDelivery(page);
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
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('openPaymentMethodScreen')());

  await expect(page.locator('#paymentOnlineCards')).toBeHidden();
  expect(await page.evaluate(() => window.__mpPublicKeys)).toEqual([]);
});
