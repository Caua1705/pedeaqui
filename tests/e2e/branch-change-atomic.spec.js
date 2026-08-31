import { test, expect } from '@playwright/test';
import { mockApi, menuForBranch, RESTAURANT_URL, SLUG, BRANCH_MATRIZ, BRANCH_VARJOTA, esperarAppPronto } from './helpers.js';

// ============================================================================
//  Trocar de loja e ou tudo muda, ou nada muda.
//
//  O defeito: o `catch` do /menu so escrevia no console e a funcao seguia.
//  restoreCart() entao conferia a sacola guardada da loja NOVA contra os
//  produtos da ANTIGA, que ainda estavam em memoria. Como os ids de produto nao
//  se repetem entre filiais, nada casava, o carrinho virava vazio — e a ultima
//  linha de restoreCart() gravava esse vazio POR CIMA da sacola guardada.
//
//  O cliente perdia o pedido montado por causa de uma falha de rede, e a tela
//  nao dizia nada.
// ============================================================================

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

// Cada filial tem os PROPRIOS ids de produto — e essa e a premissa que fazia o
// defeito doer. O H2O da Matriz nao existe na Varjota e vice-versa.
const H2O_MATRIZ = '80f16645-1d6b-4fca-b9e4-dd838e4134d2';
const H2O_VARJOTA = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa';

function menuDaVarjota() {
  const base = menuForBranch(BRANCH_VARJOTA);
  return {
    ...base,
    products: base.products.map((product) =>
      product.id === H2O_MATRIZ ? { ...product, id: H2O_VARJOTA, name: 'H2O Varjota' } : product
    )
  };
}

async function semearMatriz(page) {
  await page.addInitScript(
    ({ slug, branchId }) => {
      // Semeia SO na primeira carga. addInitScript roda a cada navegacao,
      // inclusive no reload — sobrescrever aqui devolveria o app para a Matriz
      // e o teste de boot nunca chegaria a pedir o cardapio da filial guardada.
      const chave = `rapidex.operationContext.${slug}`;
      if (localStorage.getItem(chave)) return;
      localStorage.setItem(
        chave,
        JSON.stringify({
          order_type: 'pickup',
          branch_id: branchId,
          branch_label: 'Matriz',
          confirmed: true
        })
      );
      localStorage.setItem(
        'rapidex.customer.profile',
        JSON.stringify({ name: 'E2E Test', phone: '85999999999' })
      );
    },
    { slug: SLUG, branchId: BRANCH_MATRIZ }
  );
}

const sacolaGuardada = (page, branchId) =>
  page.evaluate((id) => {
    const raw = localStorage.getItem(`rapidex.cart.junior-da-picanha::${id}`);
    return raw ? JSON.parse(raw).items.length : null;
  }, branchId);

async function montarSacola(page, qty = 2) {
  await esperarAppPronto(page);
  await page.waitForFunction(() => typeof window.openProduct === 'function');
  await page.evaluate(
    ({ productId, qty }) => {
      window.openProduct(productId);
      for (let i = 1; i < qty; i++) window.changeQty(1);
      window.addToCart();
    },
    { productId: H2O_MATRIZ, qty }
  );
}

/**
 * Troca de filial e ESPERA a troca terminar.
 *
 * confirmOperation() dispara handleMenuBranchChange() sem aguardar — de
 * proposito: a tela fecha na hora e o cardapio chega por tras. Entao o
 * page.evaluate volta antes de a sacola ter sido restaurada, e afirmar logo
 * depois e uma corrida: passa sozinho e falha com a maquina ocupada.
 *
 * `linhasEsperadas` e o numero de LINHAS que a sacola deve ter quando a troca
 * assentar. Esperar por ele e esperar pelo restoreCart(), que e o ultimo passo
 * tanto do caminho feliz quanto do rollback.
 */
async function trocarPara(page, branchId, linhasEsperadas) {
  await page.evaluate((id) => {
    window.RapidexActions.resolve('openOperationScreen')();
    window.RapidexActions.resolve('selectBranch')(id);
    window.RapidexActions.resolve('confirmOperation')();
  }, branchId);
  await expect
    .poll(() => page.evaluate(() => window.PedeAquiCartStore.get().items.length), {
      timeout: 15_000
    })
    .toBe(linhasEsperadas);
}

test('troca bem-sucedida guarda a sacola da loja anterior na chave dela', async ({ page }) => {
  // A linha de base: sem ela, o teste seguinte nao prova nada.
  await mockApi(page);
  await page.route(/\/menu\?.*branch_id=/, (route) => {
    const branchId = new URL(route.request().url()).searchParams.get('branch_id');
    return route.fulfill(
      json(branchId === BRANCH_VARJOTA ? menuDaVarjota() : menuForBranch(branchId))
    );
  });
  await semearMatriz(page);

  await page.goto(RESTAURANT_URL);
  await montarSacola(page, 2);
  expect(await sacolaGuardada(page, BRANCH_MATRIZ)).toBe(1);

  await trocarPara(page, BRANCH_VARJOTA, 0); // a Varjota nasce sem sacola
  await expect(page.locator('#appToast')).toContainText('ficou guardada');

  // A sacola da Matriz continua onde estava, e a da Varjota nasce vazia.
  expect(await sacolaGuardada(page, BRANCH_MATRIZ)).toBe(1);
  await expect(page.locator('#cartItemCountLabel')).toHaveText('0 itens');
});

test('cardapio da filial nova falha: nada muda e a sacola sobrevive', async ({ page }) => {
  await mockApi(page);
  await page.route(/\/menu\?.*branch_id=/, (route) => {
    const branchId = new URL(route.request().url()).searchParams.get('branch_id');
    // A filial nova esta fora do ar; a atual continua respondendo.
    if (branchId === BRANCH_VARJOTA) return route.fulfill(json({ detail: 'Erro interno' }, 500));
    return route.fulfill(json(menuForBranch(branchId)));
  });
  await semearMatriz(page);

  await page.goto(RESTAURANT_URL);
  await montarSacola(page, 2);
  expect(await sacolaGuardada(page, BRANCH_MATRIZ)).toBe(1);

  await trocarPara(page, BRANCH_VARJOTA, 1); // o rollback devolve a linha da Matriz

  // A tela diz o que houve, em vez de fingir que trocou.
  await expect(page.locator('#appToast')).toContainText('Não foi possível carregar o cardápio');
  await expect(page.locator('#appToast')).toContainText('Matriz');

  // O contexto voltou: o app continua na Matriz.
  const contexto = await page.evaluate(() =>
    JSON.parse(localStorage.getItem('rapidex.operationContext.junior-da-picanha'))
  );
  expect(contexto.branch_id).toBe(BRANCH_MATRIZ);

  // E a sacola da Matriz esta INTACTA — nem apagada da tela, nem sobrescrita
  // no armazenamento. Este era o dano: 1 item viraria 0, guardado.
  expect(await sacolaGuardada(page, BRANCH_MATRIZ)).toBe(1);
  // 1 LINHA de sacola com 2 unidades — o contador da tela conta unidades.
  await expect(page.locator('#cartItemCountLabel')).toHaveText('2 itens');
  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#cartList')).toContainText('H2O');
});

test('o cupom aplicado nao atravessa a troca de loja', async ({ page }) => {
  // O cupom e da SACOLA de uma loja: o desconto foi calculado contra os precos
  // e o subtotal daquela filial. Levar a escolha adiante faria o pedido da loja
  // nova nascer com um coupon_id validado contra outra sacola.
  //
  // O pagamento tambem e limpo por clearBranchScopedSelection(), mas ele JA era
  // derrubado de outro jeito — o refetch de /info da filial nova zera os mapas
  // de metodo. Este teste cobre o que a limpeza acrescenta de fato.
  await mockApi(page, {
    onPreviewCoupon: (route) =>
      route.fulfill(
        json({
          coupon_id: 'd0d99eee-9cf1-409d-bd48-b5afb991da70',
          coupon_code: 'JP10',
          discount_type: 'percent',
          subtotal: '21.15',
          delivery_fee: '0.00',
          discount_amount: '2.12',
          total_after_coupon: '20.02',
          valid: true
        })
      )
  });
  await page.route(/\/menu\?.*branch_id=/, (route) => {
    const branchId = new URL(route.request().url()).searchParams.get('branch_id');
    return route.fulfill(
      json(branchId === BRANCH_VARJOTA ? menuDaVarjota() : menuForBranch(branchId))
    );
  });
  await semearMatriz(page);

  await page.goto(RESTAURANT_URL);

  // A filial de DESTINO precisa ter sacola propria: com ela vazia o cupom cai
  // por outros motivos e o teste passaria sem provar nada.
  await montarSacola(page, 3);
  await trocarPara(page, BRANCH_VARJOTA, 0);
  await expect(page.locator('#appToast')).toContainText('ficou guardada');
  await page.evaluate((productId) => {
    window.openProduct(productId);
    window.changeQty(1);
    window.changeQty(1);
    window.addToCart();
  }, H2O_VARJOTA);
  expect(await sacolaGuardada(page, BRANCH_VARJOTA)).toBe(1);

  // Volta para a Matriz e aplica o cupom LA.
  await trocarPara(page, BRANCH_MATRIZ, 1); // a sacola da Matriz volta
  await expect(page.locator('#cartItemCountLabel')).toHaveText('3 itens');
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await page.locator('.coupon-detail-use').click();
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);
  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#csTotal')).toContainText('20,02');
  expect(await page.evaluate(() => window.PedeAquiCartStore.get().coupon?.code)).toBe('JP10');
  await page.evaluate(() => window.closeModal?.('cartModal'));

  // Troca para a Varjota, que tem sacola guardada: a sacola volta cheia e o
  // cupom NAO vem junto.
  await trocarPara(page, BRANCH_VARJOTA, 1); // a sacola da Varjota volta
  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#cartList'), 'a sacola da Varjota voltou').toContainText('H2O');
  await expect(page.locator('#cartItemCountLabel')).toHaveText('3 itens');
  expect(
    await page.evaluate(() => window.PedeAquiCartStore.get().coupon),
    'o cupom da Matriz nao pode valer na Varjota'
  ).toBeNull();
  // E o total volta a ser o cheio: 21,15 + 0,99, sem o desconto da outra loja.
  await expect(page.locator('#csTotal')).toContainText('22,14');
});

test('boot com o cardapio da filial guardada fora do ar nao apaga a sacola dela', async ({
  page
}) => {
  // No boot quem busca o cardapio da filial guardada e o proprio loadInitialData,
  // ANTES de qualquer render. Um 500 ali nao e "cardapio desencontrado": e falha
  // de carregamento do app, e a tela de erro com "Tentar novamente" e a resposta
  // certa. O que este teste fixa e a consequencia que importa para o dinheiro —
  // restoreCart() nao chega a rodar, entao a sacola guardada nao e conferida
  // contra o cardapio errado nem sobrescrita pelo vazio.
  await mockApi(page);
  await page.route(/\/menu\?.*branch_id=/, (route) => {
    const branchId = new URL(route.request().url()).searchParams.get('branch_id');
    return route.fulfill(
      json(branchId === BRANCH_VARJOTA ? menuDaVarjota() : menuForBranch(branchId))
    );
  });
  await semearMatriz(page);

  // Monta a sacola na Varjota e sai.
  await page.goto(RESTAURANT_URL);
  await montarSacola(page, 2);
  await trocarPara(page, BRANCH_VARJOTA, 0);
  await expect(page.locator('#appToast')).toContainText('ficou guardada');
  await page.evaluate(
    ({ productId }) => {
      window.openProduct(productId);
      window.addToCart();
    },
    { productId: H2O_VARJOTA }
  );
  expect(await sacolaGuardada(page, BRANCH_VARJOTA)).toBe(1);

  // Nova visita: o cardapio DA VARJOTA (a filial guardada) esta fora do ar.
  await page.route(/\/menu\?.*branch_id=/, (route) => {
    const branchId = new URL(route.request().url()).searchParams.get('branch_id');
    if (branchId === BRANCH_VARJOTA) return route.fulfill(json({ detail: 'Erro interno' }, 500));
    return route.fulfill(json(menuForBranch(branchId)));
  });
  await page.reload();

  // Tela de erro com retry, nao uma loja meio carregada.
  await expect(page.locator('body')).toHaveClass(/app-error/);
  await expect(page.locator('#appLoaderTitle')).toHaveText('Não foi possível carregar');
  await expect(page.locator('#appLoaderRetry')).toBeVisible();

  // E a sacola guardada da Varjota continua la, com o item dentro.
  expect(await sacolaGuardada(page, BRANCH_VARJOTA)).toBe(1);
});
