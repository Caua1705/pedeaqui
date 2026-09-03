import { test, expect } from '@playwright/test';
import { mockApi, seedPickupSession, addH2OToCart, ORDERS, MENU, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// ============================================================================
//  COR DE ESTADO NÃO É COR DE MARCA.
//
//  A regra do white-label (§7 da skill) diz que cor chumbada é bug. Ela tem uma
//  exceção que precisa estar escrita, senão vira o defeito ao contrário: o que
//  o estado comunica — negado, concluído, apagar — não pode andar junto da
//  marca, porque aí a informação some. O X de "Recusado" e o check de
//  "Finalizado" saíam os dois em `var(--brand-light)`: a mesma cor, e a única
//  diferença entre "seu pedido foi recusado" e "seu pedido ficou pronto" era o
//  desenho de 12px dentro do círculo.
//
//  Num tenant azul isso fica pior ainda: dois círculos azuis, um deles dando
//  má notícia.
//
//  A suíte roda num tenant AZUL de propósito. Se a cor do estado seguisse a
//  marca, estes testes leriam azul — e é isso que eles proíbem.
// ============================================================================

const AZUL = '#1B4FD8';
const AZUL_RGB = 'rgb(27, 79, 216)';

const PEDIDOS = [
  { ...ORDERS[0], id: 'order-recusado', order_number: 9001, status: 'rejected' },
  { ...ORDERS[0], id: 'order-finalizado', order_number: 9002, status: 'completed' }
];

/** Componentes de "rgb(r, g, b)". */
const canais = (css) => css.match(/\d+/g).map(Number);

async function bootarAzul(page) {
  await page.setViewportSize({ width: 414, height: 896 });
  await mockApi(page);
  const menu = JSON.parse(JSON.stringify(MENU));
  menu.restaurant.primary_color = AZUL;
  // Registrada DEPOIS de mockApi: no Playwright a última rota vence.
  await page.route('**/api.pederapidex.com/**', async (route) => {
    const url = route.request().url();
    if (/\/menu(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(menu) });
    }
    if (/\/customers\/me\/orders(\?|$)/.test(url)) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(PEDIDOS) });
    }
    return route.fallback();
  });
  await seedPickupSession(page);
  await page.addInitScript(() => localStorage.setItem('rapidex.customer.token', 'e2e-state-colors'));
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.addStyleTag({ content: '*,*::before,*::after{transition:none!important;animation:none!important}' });
}

async function abrirMeusPedidos(page) {
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')());
  await page.locator('#mobNavProfile').click();
  await page.locator('#mobViewProfile').getByRole('button', { name: 'Meus pedidos' }).click();
  await expect(page.locator('.prof-order-card')).toHaveCount(PEDIDOS.length);
}

const corDoIcone = (page, numero) =>
  page
    .locator('.prof-order-card', { hasText: `Pedido #${numero}` })
    .locator('.prof-order-status-icon')
    .evaluate(el => getComputedStyle(el).color);

test('o X de "Recusado" é VERMELHO, e não a cor do lojista', async ({ page }) => {
  await bootarAzul(page);
  await abrirMeusPedidos(page);

  const cor = await corDoIcone(page, 9001);
  expect(cor, 'o estado negativo não pode vestir a marca').not.toBe(AZUL_RGB);

  const [r, g, b] = canais(cor);
  expect(r, 'vermelho de verdade: R alto').toBeGreaterThan(150);
  expect(r - g, 'R bem acima de G').toBeGreaterThan(100);
  expect(r - b, 'R bem acima de B').toBeGreaterThan(100);
});

test('o check de "Finalizado" é VERDE, e não a cor do lojista', async ({ page }) => {
  await bootarAzul(page);
  await abrirMeusPedidos(page);

  const cor = await corDoIcone(page, 9002);
  expect(cor, 'o sucesso não pode vestir a marca').not.toBe(AZUL_RGB);

  const [r, g, b] = canais(cor);
  expect(g, 'verde de verdade: G domina').toBeGreaterThan(r);
  expect(g, 'G domina também o azul').toBeGreaterThan(b);
});

test('os dois estados não podem ser a MESMA cor', async ({ page }) => {
  // O defeito original não era "a cor errada": era a MESMA cor nos dois, e a
  // única diferença ficando no desenho de 12px dentro do círculo.
  await bootarAzul(page);
  await abrirMeusPedidos(page);

  expect(await corDoIcone(page, 9001)).not.toBe(await corDoIcone(page, 9002));
});

test('excluir ENDEREÇO é o mesmo vermelho de excluir item da sacola', async ({ page }) => {
  await bootarAzul(page);

  // O de excluir item da sacola, que já estava certo — é a referência.
  await addH2OToCart(page, 1);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.evaluate(() => {
    const uid = window.PedeAquiCartStore.get().items[0].uid;
    window.RapidexActions.resolve('openCartItemDeleteConfirm')(uid);
  });
  const excluirItem = page.locator('#cartItemDeleteConfirm .addr-delete-yes');
  await expect(excluirItem).toBeVisible();
  const vermelhoDaSacola = await excluirItem.evaluate(el => getComputedStyle(el).backgroundColor);
  await page.evaluate(() => window.RapidexActions.resolve('closeCartItemDeleteConfirm')());

  // O de excluir endereço.
  await page.evaluate(() => window.RapidexActions.resolve('openAddrPicker')('profile'));
  await expect(page.locator('#addrPickerModal')).toHaveClass(/active/);
  const excluirEndereco = await page
    .locator('#addrPickerModal .addr-delete-yes')
    .evaluate(el => getComputedStyle(el).backgroundColor);

  expect(excluirEndereco, 'apagar endereço e apagar item usam o mesmo vermelho').toBe(
    vermelhoDaSacola
  );
  expect(excluirEndereco, 'e nenhum dos dois veste a marca').not.toBe(AZUL_RGB);
});
