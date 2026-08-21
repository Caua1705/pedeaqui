import { test, expect } from '@playwright/test';
import {
  mockApi,
  seedPickupSession,
  menuForBranch,
  MENU,
  SLUG,
  BRANCH_MATRIZ,
  BRANCH_VARJOTA,
  PRODUCT_H2O,
  RESTAURANT_URL
} from './helpers.js';

// O cardápio é DA FILIAL.
//
// Desde 20/08/2026 cada loja tem produtos, preços e disponibilidade próprios, e
// os ids de produto NÃO se repetem entre elas. O que estes testes travam é a
// coerência entre a loja escolhida e o que está na tela: a primeira carga já
// sai com a filial certa, trocar de loja refaz o cardápio, e a sacola de cada
// loja fica na loja dela — carrinho montado numa filial não migra para outra,
// e enviá-lo assim volta 400 sem dizer qual item.

const json = (body, status = 200) => ({
  status, contentType: 'application/json', body: JSON.stringify(body)
});

/** Registra o /menu e devolve a lista viva de `branch_id` pedidos. */
async function spyMenu(page, { menuFor = menuForBranch } = {}) {
  const requested = [];
  await page.route('**/restaurants/*/menu*', route => {
    const branchId = new URL(route.request().url()).searchParams.get('branch_id');
    requested.push(branchId);
    const body = menuFor(branchId);
    return route.fulfill(body?.__status ? json(body, body.__status) : json(body));
  });
  return requested;
}

const boot = async (page) => {
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
};

const trocarPara = (page, branchId) => page.evaluate(id => {
  window.RapidexActions.resolve('openOperationScreen')();
  window.RapidexActions.resolve('selectBranch')(id);
  window.RapidexActions.resolve('confirmOperation')();
}, branchId);

const itensDaSacola = page =>
  page.evaluate(() => (window.PedeAquiCartStore?.get?.().items || []).length);

test('a primeira carga já sai com a filial guardada, sem passar pela padrão', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  const requested = await spyMenu(page);
  // A sessão guardada é da Varjota — que NÃO é a filial padrão do backend.
  await page.addInitScript(({ slug, branchId }) => {
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: 'pickup', branch_id: branchId, branch_label: 'Varjota', confirmed: true
    }));
  }, { slug: SLUG, branchId: BRANCH_VARJOTA });

  await boot(page);

  // Uma chamada só, e já com a loja certa. Carregar a padrão e corrigir depois
  // mostraria preço de outra loja no primeiro quadro.
  expect(requested).toEqual([BRANCH_VARJOTA]);
});

test('trocar de filial refaz o cardápio, e a sacola de cada loja fica na loja dela', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  const requested = await spyMenu(page);
  await seedPickupSession(page); // Matriz
  await boot(page);

  await page.evaluate(id => {
    window.openProduct(id);
    window.addToCart();
  }, PRODUCT_H2O);
  expect(await itensDaSacola(page)).toBe(1);

  await trocarPara(page, BRANCH_VARJOTA);

  // O cardápio foi refeito PARA a filial nova.
  await expect.poll(() => requested).toEqual([BRANCH_MATRIZ, BRANCH_VARJOTA]);
  // A sacola da Matriz não atravessa: os ids são de lá, e o pedido da Varjota
  // os recusaria com 400 sem dizer qual item.
  await expect.poll(() => itensDaSacola(page)).toBe(0);
  // E o cliente é avisado, em vez de ver a sacola sumir sem explicação.
  await expect(page.locator('#appToast')).toBeVisible();
  await expect(page.locator('#appToast')).toContainText(/sacola/i);

  // Voltar para a Matriz encontra a sacola como estava — guardada, não perdida.
  await trocarPara(page, BRANCH_MATRIZ);
  await expect.poll(() => itensDaSacola(page)).toBe(1);
});

test('filial guardada que saiu do ar não vira "restaurante indisponível"', async ({ page }) => {
  // O backend responde 404 para filial que não é mais deste restaurante. Sem
  // separar esse 404 do "restaurante não existe", um branch_id velho no
  // localStorage prende o cliente numa tela de erro que recarregar não conserta.
  const SUMIDA = '00000000-0000-4000-8000-0000000000ff';
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  const requested = await spyMenu(page, {
    menuFor: branchId => (branchId && branchId !== BRANCH_MATRIZ && branchId !== BRANCH_VARJOTA
      ? { detail: 'Filial não encontrada para este restaurante', __status: 404 }
      : menuForBranch(branchId))
  });
  await page.addInitScript(({ slug, branchId }) => {
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: 'pickup', branch_id: branchId, branch_label: 'Sumida', confirmed: true
    }));
  }, { slug: SLUG, branchId: SUMIDA });

  await boot(page);

  // Tentou a guardada, levou 404, e refez sem filial — o app subiu.
  expect(requested).toEqual([SUMIDA, null]);
  await expect(page.locator('body')).not.toHaveClass(/app-error/);
  await expect(page.locator('.delivery-widget')).toBeVisible();

  // E a filial morta não fica guardada para repetir o 404 no próximo boot.
  const guardado = await page.evaluate(slug =>
    JSON.parse(localStorage.getItem(`rapidex.operationContext.${slug}`) || 'null'), SLUG);
  expect(guardado?.branch_id, 'a filial que sumiu continuou guardada').toBeFalsy();
  expect(guardado?.confirmed, 'seguiu confirmado com uma filial que não existe').toBe(false);
});

test('produto que só existe na filial escolhida abre pelo cartão do assistente', async ({ page }) => {
  // O bug que fechou: o assistente respondia pela loja escolhida e o cardápio
  // carregado era o da filial padrão, então `openProduct` não achava o id e o
  // toque no cartão não fazia NADA.
  const SO_DA_VARJOTA = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeee1';
  const produtoExclusivo = {
    ...MENU.products[0],
    id: SO_DA_VARJOTA,
    name: 'Picanha da Varjota',
    slug: 'picanha',
    price: 99.9,
    option_groups: []
  };

  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page);
  await spyMenu(page, {
    menuFor: branchId => (branchId === BRANCH_VARJOTA
      ? { ...menuForBranch(branchId), products: [produtoExclusivo, ...MENU.products.slice(1)] }
      : menuForBranch(branchId))
  });
  await page.route('**/chat', route => route.fulfill(json({
    response_type: 'products',
    message: 'Achei esta.',
    products: [{ id: SO_DA_VARJOTA, name: 'Picanha da Varjota', price: 99.9 }]
  })));

  await seedPickupSession(page);
  await boot(page);
  await trocarPara(page, BRANCH_VARJOTA);

  await page.evaluate(() => window.RapidexActions.resolve('mobNavAssistant')());
  await page.locator('#assistantInput').fill('tem picanha?');
  await page.evaluate(() => window.assistantSendMessage());

  await page.locator('.assistant-product-card').first().click({ timeout: 15000 });
  await page.locator('.assistant-product-detail-question').click();

  // O produto abre no cardápio — o toque no cartão termina em algum lugar.
  await expect(page.locator('#productModal')).toHaveClass(/active/);
  await expect(page.locator('#pmName')).toHaveText('Picanha da Varjota');
});
