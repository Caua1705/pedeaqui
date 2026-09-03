import { test, expect } from '@playwright/test';
import { mockApi, BRANCH_MATRIZ, RESTAURANT_URL, SLUG, esperarAppPronto } from './helpers.js';

// A tela "Meus endereços": o teto de 10 e o botão que encolhia.
//
// ── O botão que encolhia (medido) ────────────────────────────────────────────
// `.cart-scroll.addr-picker-body` é `display:flex; flex-direction:column`, e o
// botão de adicionar nasce com o `flex-shrink:1` do padrão. Enquanto a lista
// cabe na tela nada acontece; quando ela passa (10 endereços: scrollHeight 1002
// contra clientHeight 826), o algoritmo do flex tira a sobra de quem pode
// encolher — e o único que podia era o botão. Medido: 45px com 3 endereços,
// **15px** com 10. O `height:45px!important` não protege: num container flex de
// coluna, `height` é a base do item, e é dela que o encolhimento sai.
//
// O idioma do conserto já existe no repositório: `.cart-location-alert`
// (restaurant.css) carrega `flex-shrink:0!important` pelo mesmo motivo.
//
// ── O teto de 10 ────────────────────────────────────────────────────────────
// É regra do FRONT: `create_address` (customer_service.py:324) não tem teto
// nenhum, e nenhuma rota devolve o número máximo. O botão continua clicável e o
// aviso aparece DEPOIS do clique — decisão de produto, copiando a referência.

const base = {
  street: 'Rua das Flores',
  neighborhood: 'Centro',
  city: 'Fortaleza',
  state: 'CE',
  postal_code: '60000-000'
};

const enderecos = (n) =>
  Array.from({ length: n }, (_, i) => ({
    ...base,
    id: `addr-${i}`,
    label: `Endereço ${i}`,
    number: String(100 + i)
  }));

const AVISO_DO_LIMITE = 'O limite de endereços foi atingido, remova algum para adicionar um novo.';

async function abrirMeusEnderecos(page, quantos) {
  await page.setViewportSize({ width: 414, height: 896 });
  await mockApi(page);
  await page.addInitScript(
    ({ branchId, slug }) => {
      localStorage.setItem(
        'rapidex.customer.profile',
        JSON.stringify({ id: 'customer-e2e', name: 'Cliente E2E', phone: '85999999999' })
      );
      localStorage.removeItem('rapidex.customerAddresses.local');
      localStorage.setItem(
        `rapidex.operationContext.${slug}`,
        JSON.stringify({ order_type: 'delivery', branch_id: branchId, branch_label: 'Matriz', confirmed: true })
      );
    },
    { branchId: BRANCH_MATRIZ, slug: SLUG }
  );
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(lista => {
    window.PedeAquiCustomerAuth.setToken('e2e-customer-token');
    window.PedeAquiCustomerService.getCurrentCustomer = async () => ({
      id: 'customer-e2e',
      name: 'Cliente E2E',
      phone: '85999999999'
    });
    window.PedeAquiAddressService.getCustomerAddresses = async () => lista;
    window.PedeAquiOrderService.getCustomerOrders = async () => [];
  }, enderecos(quantos));

  await page.locator('#mobNavProfile').click();
  await page.locator('.prof-account-row', { hasText: /Meus endere/ }).click();
  await expect(page.locator('#addrPickerModal')).toHaveClass(/active/);
  await expect(page.locator('#addrPickerList .addr-picker-item')).toHaveCount(quantos);
}

const alturaDoBotao = (page) =>
  page.locator('.addr-picker-add-btn').evaluate(el => Math.round(el.getBoundingClientRect().height));

test('o botão de adicionar não encolhe quando a lista passa da tela', async ({ page }) => {
  await abrirMeusEnderecos(page, 3);
  expect(await alturaDoBotao(page), 'com a lista curta o botão já era 45').toBe(45);

  await abrirMeusEnderecos(page, 10);
  expect(await alturaDoBotao(page), 'a lista longa não pode espremer o botão').toBe(45);
});

test('no limite, o aviso aparece DEPOIS do clique e o formulário não abre', async ({ page }) => {
  await abrirMeusEnderecos(page, 10);

  const aviso = page.locator('#addrPickerLimit');
  await expect(aviso, 'o aviso não existe antes do clique').toBeHidden();

  // O botão continua clicável: é decisão de produto, e é o clique que explica.
  await expect(page.locator('.addr-picker-add-btn')).toBeEnabled();
  await page.locator('.addr-picker-add-btn').click();

  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText(AVISO_DO_LIMITE);
  // O ícone de exclamação é o da classe de erro que já existe (.reg-summary).
  await expect(aviso.locator('.reg-summary-icon')).toHaveText('!');
  await expect(page.locator('#addAddressModal')).not.toHaveClass(/active/);
  await expect(page.locator('#addrDetailsModal')).not.toHaveClass(/active/);
});

test('abaixo do limite o botão abre o formulário, sem aviso nenhum', async ({ page }) => {
  await abrirMeusEnderecos(page, 9);

  await page.locator('.addr-picker-add-btn').click();

  await expect(page.locator('#addrPickerLimit')).toBeHidden();
  await expect(page.locator('#addAddressModal')).toHaveClass(/active/);
});
