import { test, expect } from '@playwright/test';
import { mockApi, pixOrder, confirmOrderSheet, esperarAppPronto, RESTAURANT_URL, SLUG, BRANCH_MATRIZ, MENU } from './helpers.js';

// ============================================================================
//  A REDE DO DINHEIRO — a cadeia de preço da sacola, como ela é HOJE.
//
//  Isto não testa uma tela: testa a CONTA. Existe para que qualquer movimento
//  futuro no bloco da sacola tenha como provar que não mexeu num número, e por
//  isso ele é escrito ANTES de qualquer movimento (regra da rodada: se a rede
//  não existir, nada se move).
//
//  POR QUE É E2E, E NÃO UNITÁRIO. `cartTotals()` é o dono único do total e vive
//  DENTRO do IIFE de `restaurant-page.js` — não vai para `window`, não está no
//  `PedeAquiAppPort`, e a fase B2 tirou 141 nomes do escopo global de propósito.
//  Dar-lhe uma porta só para o teste seria mexer no caminho do dinheiro ANTES
//  de a rede existir, que é exatamente a ordem que esta rodada proíbe. Então a
//  rede mede o que o cliente vê, que é a afirmação que interessa de qualquer
//  forma.
//
//  OS NÚMEROS DISCORDAM DE PROPÓSITO. Nenhuma soma aqui pode dar o mesmo
//  resultado por dois caminhos: se o fixture fizer os dois lados coincidirem, a
//  divergência fica invisível e o teste não prova nada (é a armadilha do
//  "3 × 7,05 + 0,99 = 22,14" que a skill registra).
//
//    2 × (30,00 + 4,30 de adicional) = 68,60   subtotal
//                          +   0,99            taxa de serviço (do /menu)
//                          +   7,40            taxa de entrega (do /delivery/estimate)
//                          = 76,99            antes do cupom
//    desconto do cupom .....  5,00   →  76,99 - 5,00 = 71,99  (a subtração local)
//    total_after_coupon ....           69,13   ← É ESTE que tem de aparecer
//
//  71,99 nunca pode aparecer na tela. Se aparecer, o front voltou a refazer a
//  conta do backend — e com teto de desconto ou arredondamento os dois números
//  divergem, o cliente confirma um e é cobrado outro.
//
//  E O CASHBACK NÃO ENTRA NA CONTA DA SACOLA. `cartTotals()` devolve
//  {subtotal, svc, delivery, discount, total} e cashback não está lá: quem
//  aplica o saldo é o backend, no pedido (`cashback_redeemed_amount`). O
//  fixture traz saldo POSITIVO nesta loja justamente para travar isso — se
//  alguém fizer o front descontar cashback do total, este teste cai.
// ============================================================================

const json = (body, status = 200) => ({
  status, contentType: 'application/json', body: JSON.stringify(body)
});

const PRODUTO = '0a1b2c3d-0000-4000-8000-00000000c0de';
const GRUPO = '0a1b2c3d-0000-4000-8000-0000000a0001';
const OPCAO = '0a1b2c3d-0000-4000-8000-00000000ded1';

const ENDERECO = {
  street: 'Rua Andrade Furtado',
  number: '955',
  neighborhood: 'Cocó',
  city: 'Fortaleza',
  state: 'Ceará',
  postal_code: '60190090',
  summary: 'Rua Andrade Furtado, 955 - Cocó'
};

/** O cardápio com UM produto que tem adicional — o fixture não tem nenhum. */
function menuComAdicional(branchId) {
  const base = JSON.parse(JSON.stringify(MENU));
  const categoria = base.categories[0];
  return {
    ...base,
    branch_id: branchId || base.branch_id,
    products: [
      {
        id: PRODUTO,
        restaurant_id: base.restaurant.id,
        branch_id: branchId || base.branch_id,
        category_id: categoria.id,
        name: 'Prato da rede',
        description: 'Existe só para a conta do dinheiro ter um adicional.',
        price: 30,
        is_active: true,
        is_available: true,
        sort_order: 0,
        option_groups: [{
          id: GRUPO,
          name: 'Acompanhamento',
          min_select: 0,
          max_select: 1,
          is_required: false,
          sort_order: 0,
          options: [{
            id: OPCAO,
            name: 'Farofa especial',
            additional_price: 4.3,
            is_active: true,
            sort_order: 0
          }]
        }]
      },
      ...base.products.filter(produto => produto.category_id === categoria.id).slice(0, 3)
    ]
  };
}

/**
 * O preview do cupom, como o backend responde.
 *
 * `total_after_coupon` PADRÃO é 69,13 de propósito: ele NÃO é 76,99 - 5,00, e
 * é ele que a tela tem de mostrar (é a asserção do segundo teste). Quem quer
 * uma resposta em que as linhas FECHEM a conta passa `previewOverrides`.
 */
const PREVIEW_PADRAO = {
  coupon_id: '0d6e7327-6637-48fb-ad67-fdc362d32ace',
  coupon_code: 'JP5',
  discount_type: 'fixed',
  subtotal: '68.60',
  delivery_fee: '7.40',
  discount_amount: '5.00',
  total_after_coupon: '69.13',
  valid: true
};

async function montarSacola(page, { comCupom = false, previewOverrides = {} } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });

  const chamadas = await mockApi(page, {
    orderResponse: pixOrder,
    onPreviewCoupon: (route) => route.fulfill(json({ ...PREVIEW_PADRAO, ...previewOverrides }))
  });

  // Depois do mockApi de propósito: a última rota registrada vence.
  await page.route(/\/menu(\?|$)/, route => route.fulfill(
    json(menuComAdicional(new URL(route.request().url()).searchParams.get('branch_id')))));

  // O /delivery/estimate NÃO é atendido pelo mockApi — cai no catch-all 404, e
  // por isso NENHUM teste da suíte tinha até hoje uma taxa de entrega de
  // verdade no total. Esta é a primeira.
  await page.route(/\/delivery\/estimate(\?|$)/, route => route.fulfill(json({
    serviceable: true,
    provider: 'e2e',
    fallback: false,
    delivery_fee: 7.4,
    distance_km: 3.2,
    eta_min: 40,
    eta_max: 55
  })));

  // Saldo de cashback POSITIVO nesta loja: ele não pode mexer no total.
  await page.route(/\/customers\/me\/cashback(\?|$)/, route => route.fulfill(json({
    balance: 31.9,
    currency: 'BRL',
    by_restaurant: [{ restaurant_slug: SLUG, restaurant_name: 'Junior da Picanha', balance: 12.5 }]
  })));

  await page.addInitScript(({ slug, branchId, endereco }) => {
    localStorage.setItem('rapidex.customer.token', 'e2e-rede-token');
    localStorage.setItem('rapidex.customer.profile', JSON.stringify({
      id: 'customer-rede', name: 'Cliente Rede', phone: '85999999999'
    }));
    localStorage.setItem('rapidex.customerAddress', JSON.stringify(endereco));
    localStorage.setItem(`rapidex.operationContext.${slug}`, JSON.stringify({
      order_type: 'delivery', branch_id: branchId, branch_label: 'Matriz',
      address: endereco, confirmed: true
    }));
  }, { slug: SLUG, branchId: BRANCH_MATRIZ, endereco: ENDERECO });

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.waitForFunction(() => typeof window.openProduct === 'function');

  // Duas unidades COM o adicional — a opção entra no preço unitário.
  await page.evaluate(({ produto, grupo, opcao }) => {
    window.openProduct(produto);
    window.RapidexActions.resolve('toggleProductOption')(grupo, opcao);
    window.changeQty(1);
    window.addToCart();
  }, { produto: PRODUTO, grupo: GRUPO, opcao: OPCAO });

  await page.evaluate(() => window.openModal('cartModal'));
  // A taxa de entrega chega por rede: esperar a LINHA parar de dizer "A definir"
  // é esperar o fim do caminho, não um relógio.
  await expect(page.locator('#csDelivery')).toHaveText('R$ 7,40');

  if (comCupom) {
    await page.evaluate(() => window.openCouponDetail('JP5'));
    await page.locator('.coupon-detail-use').click();
    await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);
    await page.evaluate(() => window.openModal('cartModal'));
  }

  return chamadas;
}

test('cada parcela entra no total: adicional, quantidade, taxa de serviço e taxa de entrega', async ({ page }) => {
  await montarSacola(page);

  // 30,00 + 4,30 de adicional = 34,30 a unidade; × 2 = 68,60.
  await expect(page.locator('#csSub')).toHaveText('R$ 68,60');
  await expect(page.locator('#csSvcFeeBtn')).toHaveText('R$ 0,99');
  await expect(page.locator('#csDelivery')).toHaveText('R$ 7,40');
  await expect(page.locator('#csTotal')).toHaveText('R$ 76,99');

  // A linha do item mostra o preço COM o adicional, e não o preço de tabela.
  await expect(page.locator('#cartList')).toContainText('68,60');
  await expect(page.locator('#cartList')).toContainText('Farofa especial');
});

test('com cupom, o total é o total_after_coupon do backend — nunca a nossa subtração', async ({ page }) => {
  await montarSacola(page, { comCupom: true });

  // As parcelas continuam as mesmas; só o total desce, e para o número DELE.
  await expect(page.locator('#csSub')).toHaveText('R$ 68,60');
  await expect(page.locator('#csSvcFeeBtn')).toHaveText('R$ 0,99');
  await expect(page.locator('#csDelivery')).toHaveText('R$ 7,40');
  await expect(page.locator('#csTotal')).toHaveText('R$ 69,13');

  // 76,99 - 5,00 = 71,99. Este número não pode existir em lugar nenhum da tela.
  await expect(page.locator('#cartModal')).not.toContainText('71,99');
});

// ============================================================================
//  A LINHA DE DESCONTO — o defeito que o cliente via como dinheiro sumindo.
//
//  A seção "Valores" tinha QUATRO linhas: Subtotal, Taxa de serviço, Taxa de
//  entrega e Total. Nenhuma de desconto. Com um cupom aplicado o cliente lia
//  68,60 + 0,99 + 7,40 = 76,99 nas linhas de cima e um Total de 69,13 embaixo,
//  com R$ 7,86 de diferença e nada explicando.
//
//  É o MESMO defeito que criou o cart-service-fee.spec.js ("num pedido de
//  R$ 0,01 o cliente via Subtotal R$ 0,01 e Total R$ 1,00 — R$ 0,99 sem uma
//  linha nenhuma"), agora na linha do cupom em vez da taxa. A regra que os dois
//  guardam é a mesma: NENHUMA parcela do total pode ficar sem linha.
// ============================================================================

test('o desconto do cupom tem linha própria: nada some da sacola sem explicação', async ({ page }) => {
  await montarSacola(page, { comCupom: true });

  // O número é o do contrato (`discount_amount`), com o sinal que ele tem na
  // conta: uma linha que diz "R$ 5,00" no meio de somas leria como mais uma
  // parcela SOMANDO.
  await expect(page.locator('#csDiscountRow')).toBeVisible();
  await expect(page.locator('#csDiscount')).toHaveText('- R$ 5,00');
});

test('sem cupom não há linha de desconto — nem um "R$ 0,00" solto', async ({ page }) => {
  // Mesma regra da taxa de serviço: parcela zerada é linha FORA, não um
  // "R$ 0,00" que o cliente tem de interpretar.
  await montarSacola(page);
  // toBeHidden() SOZINHO passa com o elemento inexistente — e foi exatamente
  // isso que ele fez na execução em que os dois irmãos ficaram vermelhos, antes
  // de a linha existir. Exigir a contagem primeiro é o que faz este teste
  // afirmar "existe e está escondida" em vez de "não achei nada".
  await expect(page.locator('#csDiscountRow')).toHaveCount(1);
  await expect(page.locator('#csDiscountRow')).toBeHidden();
});

test('com o preview fechando a conta, as linhas da sacola fecham junto', async ({ page }) => {
  // O fixture PADRÃO tem um total_after_coupon que não fecha (69,13), de
  // propósito — é assim que se prova que a tela não refaz a subtração. Este
  // teste é o outro lado: quando o backend manda um total que FECHA
  // (76,99 - 5,00), as quatro linhas da sacola têm de somar exatamente ele.
  //
  // O que ele trava é a RENDERIZAÇÃO: dadas as parcelas e o desconto do
  // backend, a tela mostra uma conta que o cliente consegue conferir de cabeça.
  await montarSacola(page, { comCupom: true, previewOverrides: { total_after_coupon: '71.99' } });

  await expect(page.locator('#csSub')).toHaveText('R$ 68,60');
  await expect(page.locator('#csSvcFeeBtn')).toHaveText('R$ 0,99');
  await expect(page.locator('#csDelivery')).toHaveText('R$ 7,40');
  await expect(page.locator('#csDiscount')).toHaveText('- R$ 5,00');
  await expect(page.locator('#csTotal')).toHaveText('R$ 71,99');

  // A conta, feita aqui do jeito que o cliente faria: 68,60 + 0,99 + 7,40 - 5,00.
  const lido = (seletor) => page.locator(seletor).textContent()
    .then(texto => Number(texto.replace(/[^\d,]/g, '').replace(',', '.')));
  const [sub, svc, entrega, desconto, total] = await Promise.all(
    ['#csSub', '#csSvcFeeBtn', '#csDelivery', '#csDiscount', '#csTotal'].map(lido));
  expect(Number((sub + svc + entrega - desconto).toFixed(2)),
    'as linhas de "Valores" têm de somar o Total — senão sobra dinheiro sem explicação')
    .toBe(total);
});

test('o saldo de cashback da loja NÃO desconta nada da sacola', async ({ page }) => {
  // Saldo de R$ 12,50 nesta loja (e R$ 31,90 na conta inteira). Quem aplica
  // cashback é o backend, no pedido. Se o front começar a descontar, o total
  // deixa de ser 76,99 e este teste cai.
  await montarSacola(page);
  await expect(page.locator('#csTotal')).toHaveText('R$ 76,99');
  await expect(page.locator('#cartModal')).not.toContainText('12,50');
});

test('o pedido leva só INPUTS: nenhum valor de dinheiro no payload', async ({ page }) => {
  const { orderRequests } = await montarSacola(page, { comCupom: true });

  await page.locator('#cartCtaBtn').click();
  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await expect(page.locator('#paymentMethodFooter')).toBeVisible();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);

  expect(orderRequests).toHaveLength(1);
  const corpo = orderRequests[0].body;
  // A regra número um do repositório, afirmada onde ela vale: o payload não
  // tem valor nenhum. Nem subtotal, nem total, nem desconto, nem taxa.
  for (const proibido of [
    'subtotal', 'total', 'total_amount', 'discount', 'discount_amount',
    'delivery_fee', 'service_fee', 'cashback', 'cashback_redeemed_amount',
    'total_after_coupon'
  ]) {
    expect(corpo, `o payload levou "${proibido}" — o front não calcula dinheiro`)
      .not.toHaveProperty(proibido);
  }
  // E leva os inputs que decidem a conta do outro lado.
  expect(corpo.coupon_id).toBe('0d6e7327-6637-48fb-ad67-fdc362d32ace');
  expect(corpo.order_type).toBe('delivery');
  expect(corpo.items[0].quantity).toBe(2);
});
