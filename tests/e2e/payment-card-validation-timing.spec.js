import { test, expect } from '@playwright/test';
import { mockApi, addH2OToCart, RESTAURANT_URL, SLUG, BRANCH_MATRIZ, seedOnlineCardBranch } from './helpers.js';

// QUANDO cada aviso aparece. São duas regras diferentes de propósito:
//
//   campo VAZIO      -> só no Salvar. Passar por um campo sem preencher é um
//                       gesto normal; acusar ali é ranzinza.
//   campo PREENCHIDO -> ao SAIR do campo. Errar um dígito do cartão é coisa
//   ERRADO              que se quer saber ali, não três campos depois.
//
// Em ambos, digitar qualquer coisa apaga o aviso na hora.

const json = (body, status = 200) => ({ status, contentType: 'application/json', body: JSON.stringify(body) });

const RED_LINE = 'rgb(239, 90, 90)';

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

/**
 * O SDK falso reproduz o que importa aqui: `change` e `validityChange` a cada
 * tecla, `blur` ao sair, e a regra de Luhn / validade / tamanho de CVV.
 */
async function installMercadoPagoSecureFieldsMock(page) {
  await page.addInitScript(() => {
    window.__mpSecureFields = {};
    const digits = value => String(value || '').replace(/\D/g, '');
    const luhnValid = (value) => {
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
      return clean.length === 3 ? [] : [{ cause: 'invalid_length' }];
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
        const input = document.createElement('input');
        input.dataset.secureField = this.type;
        input.setAttribute('aria-label', this.type);
        document.getElementById(containerId).appendChild(input);
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
      constructor() {
        this.fields = {
          create: type => new SecureField(type),
          createCardToken: async () => ({ id: 'tok_test_validation_timing' })
        };
      }
    };
  });
}

async function openCardForm(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await seedLoggedDelivery(page);
  // Sem cartao online na filial, o checkout nao desenha a area do cartao.
  await seedOnlineCardBranch(page);
  await installMercadoPagoSecureFieldsMock(page);
  await page.route('**/customers/me/addresses**', route => route.fulfill(json([])));
  await page.route('**/customers/me/cashback**', route => route.fulfill(json({ balance: 0, transactions: [] })));
  await page.route(/\/customers\/me(?:\?|$)/, route => route.fulfill(json({
    id: 'customer-e2e', name: 'Cliente Teste', phone: '85999999999'
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
  await expect(page.locator('#saveCreditCardButton')).toBeEnabled();
}

const ALL_ERRORS = ['cardNumberError', 'expirationDateError', 'securityCodeError', 'cardholderNameError', 'cardholderCpfError'];

test('campo VAZIO: nada reclama ao passar pelos campos — só o Salvar acusa', async ({ page }) => {
  await openCardForm(page);

  // Passa por TODOS os campos sem digitar nada, exatamente como quem está
  // olhando o formulário antes de preencher.
  for (const type of ['cardNumber', 'expirationDate', 'securityCode']) {
    await page.locator(`[data-secure-field="${type}"]`).click();
    await page.locator(`[data-secure-field="${type}"]`).blur();
  }
  await page.locator('#cardholderName').click();
  await page.locator('#cardholderName').blur();
  await page.locator('#cardholderCpf').click();
  await page.locator('#cardholderCpf').blur();

  // Nenhum aviso, nenhuma linha vermelha.
  for (const id of ALL_ERRORS) await expect(page.locator(`#${id}`)).toHaveText('');
  await expect(page.locator('#mpCardNumber')).not.toHaveCSS('border-bottom-color', RED_LINE);
  await expect(page.locator('#cardholderCpf')).not.toHaveCSS('border-bottom-color', RED_LINE);
  await expect(page.locator('#cardholderName')).toHaveAttribute('aria-invalid', 'false');

  // Só o Salvar acusa.
  await page.locator('#saveCreditCardButton').click();
  await expect(page.locator('#cardNumberError')).toHaveText('Campo obrigatório');
  await expect(page.locator('#expirationDateError')).toHaveText('Campo obrigatório');
  await expect(page.locator('#securityCodeError')).toHaveText('Campo obrigatório');
  await expect(page.locator('#cardholderNameError')).toHaveText('Campo obrigatório');
  await expect(page.locator('#cardholderCpfError')).toHaveText('Campo obrigatório');
  await expect(page.locator('#mpCardNumber')).toHaveCSS('border-bottom-color', RED_LINE);
  await expect(page.locator('#cardholderName')).toHaveCSS('border-bottom-color', RED_LINE);

  // E some na primeira tecla — sem precisar sair do campo.
  await page.locator('[data-secure-field="cardNumber"]').pressSequentially('4');
  await expect(page.locator('#cardNumberError')).toHaveText('');
  await expect(page.locator('#mpCardNumber')).not.toHaveCSS('border-bottom-color', RED_LINE);
  // O aviso dos OUTROS campos continua: quem sumiu foi só o do campo mexido.
  await expect(page.locator('#expirationDateError')).toHaveText('Campo obrigatório');

  await page.locator('#cardholderName').pressSequentially('A');
  await expect(page.locator('#cardholderNameError')).toHaveText('');
  await expect(page.locator('#cardholderCpfError')).toHaveText('Campo obrigatório');
});

test('campo ERRADO: acusa ao sair do campo, sem esperar o Salvar', async ({ page }) => {
  await openCardForm(page);

  // Número que não passa no dígito verificador.
  const cardNumber = page.locator('[data-secure-field="cardNumber"]');
  await cardNumber.pressSequentially('5031433215406352');
  // Enquanto digita, nada de aviso.
  await expect(page.locator('#cardNumberError')).toHaveText('');
  await cardNumber.blur();
  await expect(page.locator('#cardNumberError')).toHaveText('Número do cartão inválido');
  await expect(page.locator('#mpCardNumber')).toHaveCSS('border-bottom-color', RED_LINE);

  // Validade no passado.
  const expiration = page.locator('[data-secure-field="expirationDate"]');
  await expiration.pressSequentially('01/20');
  await expect(page.locator('#expirationDateError')).toHaveText('');
  await expiration.blur();
  await expect(page.locator('#expirationDateError')).toHaveText('Informe uma data de validade futura');

  // CVV com tamanho errado.
  const cvv = page.locator('[data-secure-field="securityCode"]');
  await cvv.pressSequentially('12');
  await cvv.blur();
  await expect(page.locator('#securityCodeError')).toHaveText('CVV inválido para a bandeira do cartão');

  // CPF inválido.
  await page.locator('#cardholderCpf').pressSequentially('12345678900');
  await expect(page.locator('#cardholderCpfError')).toHaveText('');
  await page.locator('#cardholderCpf').blur();
  await expect(page.locator('#cardholderCpfError')).toHaveText('CPF inválido');

  // Nada disso precisou do Salvar.
  await expect(page.locator('#creditCardFormError')).toBeHidden();

  // Corrigir apaga o aviso na primeira tecla, e o campo válido não volta a reclamar.
  await cardNumber.fill('');
  await cardNumber.pressSequentially('5031433215406351');
  await expect(page.locator('#cardNumberError')).toHaveText('');
  await cardNumber.blur();
  await expect(page.locator('#cardNumberError')).toHaveText('');
  await expect(page.locator('#mpCardNumber')).not.toHaveCSS('border-bottom-color', RED_LINE);
});

test('sair de um campo vazio não reclama nem depois de o Salvar já ter acusado', async ({ page }) => {
  await openCardForm(page);

  await page.locator('#saveCreditCardButton').click();
  await expect(page.locator('#cardholderCpfError')).toHaveText('Campo obrigatório');

  // Digita e apaga tudo: o campo volta a estar vazio, mas sair dele não é o
  // momento de reclamar de vazio — isso é assunto do próximo Salvar.
  await page.locator('#cardholderCpf').pressSequentially('123');
  await expect(page.locator('#cardholderCpfError')).toHaveText('');
  await page.locator('#cardholderCpf').fill('');
  await page.locator('#cardholderCpf').blur();
  await expect(page.locator('#cardholderCpfError')).toHaveText('');

  await page.locator('#saveCreditCardButton').click();
  await expect(page.locator('#cardholderCpfError')).toHaveText('Campo obrigatório');
});
