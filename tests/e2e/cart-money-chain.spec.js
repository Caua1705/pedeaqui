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
function menuComAdicional(branchId, settingsOverrides = {}) {
  const base = JSON.parse(JSON.stringify(MENU));
  const categoria = base.categories[0];
  return {
    ...base,
    settings: { ...base.settings, ...settingsOverrides },
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

async function montarSacola(page, { comCupom = false, previewOverrides = {}, settingsOverrides = {}, estimateFalha = false, enderecoIncompleto = false } = {}) {
  await page.setViewportSize({ width: 390, height: 844 });

  const chamadas = await mockApi(page, {
    orderResponse: pixOrder,
    onPreviewCoupon: (route) => route.fulfill(json({ ...PREVIEW_PADRAO, ...previewOverrides }))
  });

  // Depois do mockApi de propósito: a última rota registrada vence.
  await page.route(/\/menu(\?|$)/, route => route.fulfill(
    json(menuComAdicional(new URL(route.request().url()).searchParams.get('branch_id'), settingsOverrides))));

  // A taxa de entrega de verdade no total — este foi o primeiro arquivo da
  // suíte a ter uma. (O comentário anterior dizia que o `mockApi()` não atendia
  // o /delivery/estimate; hoje ele atende, com uma taxa fixa de 5,00. Esta rota
  // o sobrepõe com o 7,40 que a conta deste arquivo usa.)
  //
  // Com `estimateFalha`, ela devolve o 422 que a rota declara no contrato — e
  // é o único jeito de exercitar a metade da conta que trata a AUSÊNCIA da
  // taxa.
  await page.route(/\/delivery\/estimate(\?|$)/, route => estimateFalha
    ? route.fulfill(json({ detail: 'Endereco fora da area de entrega' }, 422))
    : route.fulfill(json({
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
  }, { slug: SLUG, branchId: BRANCH_MATRIZ, endereco: enderecoIncompleto ? { ...ENDERECO, number: '' } : ENDERECO });

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
  // é esperar o fim do caminho, não um relógio. Quando a estimativa FALHA, o
  // fim do caminho é a outra frase — e esperar por ela é a mesma espera por
  // condição, não um sleep.
  if (estimateFalha || enderecoIncompleto) await expect(page.locator('#csDelivery')).toHaveText('A definir');
  else await expect(page.locator('#csDelivery')).toHaveText('R$ 7,40');

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

// ============================================================================
//  OS TIPOS DE CUPOM — os três do enum, e o que cada um trava.
//
//  `CouponPreviewResponse.discount_type` é `"fixed" | "percent" |
//  "free_delivery"`. O front NÃO calcula nenhum dos três: ele exibe o
//  `discount_amount` e o `total_after_coupon` que vieram. O jeito de provar
//  isso é dar um fixture em que a conta óbvia dá OUTRO número — se os dois
//  coincidirem, o teste não distingue exibir de recalcular.
// ============================================================================

test('cupom PERCENTUAL com teto: a porcentagem da tela nunca é calculada aqui', async ({ page }) => {
  // "10% off" sobre 68,60 daria 6,86. O backend aplica um TETO de R$ 4,00 e
  // manda 4,00 — e é o 4,00 que vale. Este é o caso que o CLAUDE.md nomeia:
  // "com teto de desconto ou arredondamento os números divergem e a tela
  // mente". 6,86 não pode existir em lugar nenhum da sacola.
  await montarSacola(page, {
    comCupom: true,
    previewOverrides: {
      discount_type: 'percent',
      discount_amount: '4.00',
      // NAO e 76,99 - 4,00 = 72,99. O backend arredonda por conta dele, e os
      // dois numeros TEM de discordar: se coincidissem, este teste nao
      // distinguiria exibir de recalcular (skill 4, o fixture cujos numeros
      // coincidem).
      total_after_coupon: '73.49'
    }
  });

  await expect(page.locator('#csDiscount')).toHaveText('- R$ 4,00');
  await expect(page.locator('#csTotal')).toHaveText('R$ 73,49');
  await expect(page.locator('#cartModal'), 'a porcentagem recalculada aqui seria 6,86')
    .not.toContainText('6,86');
  await expect(page.locator('#csTotal'), 'a subtracao local daria 72,99')
    .not.toHaveText('R$ 72,99');
});

test('cupom FIXO que zera a sacola: total R$ 0,00, e o desconto é o do backend', async ({ page }) => {
  // O desconto cobre a conta inteira. O que se trava aqui é que o total não
  // vira negativo nem "R$ -0,00", e que a linha de desconto continua dizendo
  // o número do backend em vez de uma subtração local.
  await montarSacola(page, {
    comCupom: true,
    previewOverrides: {
      discount_type: 'fixed',
      discount_amount: '76.99',
      total_after_coupon: '0.00'
    }
  });

  await expect(page.locator('#csDiscount')).toHaveText('- R$ 76,99');
  await expect(page.locator('#csTotal')).toHaveText('R$ 0,00');
  await expect(page.locator('#cartModal')).not.toContainText('-R$');
});

test('cupom de FRETE GRÁTIS: a taxa de entrega continua na linha dela', async ({ page }) => {
  // free_delivery desconta a entrega, e o cliente precisa ver as DUAS coisas:
  // a taxa que existe (7,40) e o desconto que a anula. Esconder a linha da
  // entrega faria o desconto parecer maior do que é.
  await montarSacola(page, {
    comCupom: true,
    previewOverrides: {
      discount_type: 'free_delivery',
      discount_amount: '7.40',
      // Um centavo de diferenca da subtracao local (76,99 - 7,40 = 69,59), e
      // ele e de proposito: um arredondamento do backend e exatamente o que a
      // tolerancia de um centavo do submitOrder existe para tratar, e sem essa
      // diferenca o teste nao saberia dizer de onde veio o numero.
      total_after_coupon: '69.60'
    }
  });

  await expect(page.locator('#csDelivery')).toHaveText('R$ 7,40');
  await expect(page.locator('#csDiscount')).toHaveText('- R$ 7,40');
  await expect(page.locator('#csTotal')).toHaveText('R$ 69,60');
  await expect(page.locator('#csTotal'), 'a subtracao local daria 69,59')
    .not.toHaveText('R$ 69,59');
});

// ============================================================================
//  O PEDIDO MÍNIMO — e contra QUAL número ele é comparado.
//
//  `minimumOrderValue()` é comparado com `totals.subtotal`, não com o total.
//  A diferença é dinheiro em duas direções, e nenhuma das duas tinha teste:
//
//   - para BAIXO: as taxas não podem empurrar o cliente por cima do mínimo.
//     Ele pediu R$ 68,60 de comida; a taxa de entrega não é comida.
//   - para CIMA: um cupom não pode empurrá-lo por baixo do mínimo depois de
//     ele já ter alcançado. O desconto é do restaurante, não do cliente.
// ============================================================================

test('pedido mínimo é medido pelo SUBTOTAL: as taxas não empurram o cliente por cima', async ({ page }) => {
  // Mínimo R$ 72,00, escolhido no meio: o subtotal (68,60) fica ABAIXO e o
  // total com as taxas (76,99) fica ACIMA. Se a comparação usasse o total, o
  // botão liberaria — e o backend recusaria o pedido do outro lado.
  await montarSacola(page, { settingsOverrides: { min_order_value: 72 } });

  const cta = page.locator('#cartCtaBtn');
  await expect(cta).toContainText('Valor abaixo do pedido mínimo');
  await expect(cta).toContainText('R$ 72,00');
  await expect(cta).toBeDisabled();
});

test('o cupom não empurra o cliente por BAIXO do mínimo que ele já alcançou', async ({ page }) => {
  // Mínimo R$ 60,00: o subtotal de 68,60 passa. O cupom derruba o total para
  // 21,99 — bem abaixo do mínimo — e o botão TEM de continuar liberado. Quem
  // decide é o subtotal, e o cupom não mexe nele.
  await montarSacola(page, {
    comCupom: true,
    settingsOverrides: { min_order_value: 60 },
    previewOverrides: { discount_amount: '55.00', total_after_coupon: '21.99' }
  });

  await expect(page.locator('#csTotal')).toHaveText('R$ 21,99');
  const cta = page.locator('#cartCtaBtn');
  await expect(cta).not.toContainText('pedido mínimo');
  await expect(cta).toBeEnabled();
});

// ============================================================================
//  TUDO AO MESMO TEMPO — a conta inteira, numa sacola só.
//
//  Cada teste acima isola uma parcela. Este junta as cinco (item com adicional,
//  quantidade, taxa de serviço, taxa de entrega e cupom percentual com teto),
//  com saldo de cashback na conta e um pedido mínimo alcançado, e afirma as
//  cinco linhas E a soma delas. É a asserção que pega o defeito que só aparece
//  na combinação — uma parcela que some quando outra entra.
// ============================================================================

test('todas as parcelas juntas: cinco linhas, e a soma delas é o total', async ({ page }) => {
  await montarSacola(page, {
    comCupom: true,
    settingsOverrides: { min_order_value: 60 },
    previewOverrides: {
      discount_type: 'percent',
      discount_amount: '6.86',
      // 76,99 - 6,86. Aqui o backend FECHA a conta de propósito: o objetivo
      // deste teste é a soma das linhas, e para isso os dois lados precisam
      // concordar. Que a tela obedece a um total_after_coupon que NÃO fecha
      // já está travado no segundo teste deste arquivo.
      total_after_coupon: '70.13'
    }
  });

  await expect(page.locator('#csSub')).toHaveText('R$ 68,60');
  await expect(page.locator('#csSvcFeeBtn')).toHaveText('R$ 0,99');
  await expect(page.locator('#csDelivery')).toHaveText('R$ 7,40');
  await expect(page.locator('#csDiscount')).toHaveText('- R$ 6,86');
  await expect(page.locator('#csTotal')).toHaveText('R$ 70,13');
  await expect(page.locator('#cartCtaBtn')).not.toContainText('pedido mínimo');

  const lido = (seletor) => page.locator(seletor).textContent()
    .then(texto => Number(texto.replace(/[^\d,]/g, '').replace(',', '.')));
  const [sub, svc, entrega, desconto, total] = await Promise.all(
    ['#csSub', '#csSvcFeeBtn', '#csDelivery', '#csDiscount', '#csTotal'].map(lido));
  expect(Number((sub + svc + entrega - desconto).toFixed(2)),
    'com as cinco parcelas na tela, nenhuma pode sumir da soma').toBe(total);

  // E o saldo de cashback (R$ 12,50 nesta loja) continua fora da conta, mesmo
  // com todo o resto presente — quem o aplica é o backend, no pedido.
  await expect(page.locator('#cartModal')).not.toContainText('12,50');
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

// ============================================================================
//  A TAXA DE ENTREGA QUE NÃO VEIO.
//
//  Medido em 02/09/2026: `POST /delivery/estimate` era exercitado 34 vezes na
//  suíte e SEMPRE com 200. A falha dele nunca tinha sido testada — e ela mexe
//  no total, porque `deliveryFee()` (restaurant-page.js:187) devolve
//  `currentDeliveryEstimateFee() ?? 0`: sem estimativa, a entrega entra como
//  ZERO na conta.
//
//  Zero na conta seria um total mentiroso, e o que impede o estrago é uma
//  segunda peça: `hasValidDeliveryEstimateFee()` fica falso e
//  `validateOrderPayload` BARRA a criação do pedido.
//
//  O unitário de `order-payload` já provava o validador com
//  `hasValidDeliveryFee: false`. O que ninguém provava era a FIAÇÃO: que uma
//  falha de verdade da rota chega até aquele estado. Um validador certo ligado
//  ao lugar errado passa nos dois testes separados e deixa o pedido sair com o
//  frete zerado.
// ============================================================================
test('estimativa que FALHA: o total sai SEM o frete, e por isso o pedido é barrado', async ({ page }) => {
  const chamadas = await montarSacola(page, { estimateFalha: true });

  // A LINHA DE VALORES não inventa "R$ 0,00": ela diz que a taxa ainda não
  // existe. Até 02/09/2026 escrevia R$ 0,00, e a conta FECHAVA na tela —
  // 68,60 + 0,99 + 0,00 = 69,59 —, o que é pior que uma conta que não fecha:
  // uma tela coerente e mentirosa não levanta suspeita nenhuma.
  await expect(page.locator('#csDelivery')).toHaveText('A definir');
  await expect(page.locator('#cartDeliveryFeeText')).toHaveText(/indispon/i);

  // E O TOTAL SAI SEM O FRETE — 68,60 + 0,99 + 0. Isto não é um defeito
  // escondido, é o que `deliveryFee()` faz por construção
  // (`currentDeliveryEstimateFee() ?? 0`), e escrever o número aqui é o que
  // torna visível o tamanho do que a guarda de baixo está segurando: 7,40 a
  // menos do que o restaurante receberia.
  await expect(page.locator('#csTotal')).toHaveText('R$ 69,59');

  // A GUARDA. Sem ela o cliente confirmaria 69,59 e o pedido nasceria com um
  // frete que ninguém apurou.
  const cta = page.locator('#cartCtaBtn');
  await cta.click();
  await expect(page.locator('#paymentMethodModal')).toHaveClass(/active/);
  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await cta.click();
  // A validacao roda na CONFIRMACAO, nao no botao da sacola: um spec que clique
  // so no CTA nunca ve o POST /orders — nem a recusa dele (skill §4).
  await confirmOrderSheet(page);

  await expect(page.locator('#cartOrderError')).toBeVisible();
  await expect(page.locator('#cartOrderError')).toContainText(/taxa de entrega/i);
  expect(chamadas.orderRequests, 'nenhum pedido pode nascer sem a taxa apurada').toHaveLength(0);
});

test('endereço INCOMPLETO: a estimativa nem é pedida, e o pedido é barrado igual', async ({ page }) => {
  // A MESMA falta de taxa, por OUTRA causa — e esta é a mais provável em
  // produção. `deliveryEstimateKey()` (restaurant-page.js:3703) devolve `null`
  // quando `validAddressForApi()` é falso, então a rota nem chega a ser
  // chamada: não há 422 para ler, não há erro no console, e o estado final é o
  // mesmo do teste acima — taxa ausente, total sem frete.
  //
  // Um endereço guardado sem número é reachável de verdade: basta ele ter sido
  // salvo antes de o campo virar obrigatório, ou vir de uma importação antiga.
  const chamadas = await montarSacola(page, { enderecoIncompleto: true });

  await expect(page.locator('#csDelivery')).toHaveText('A definir');
  await expect(page.locator('#csTotal')).toHaveText('R$ 69,59');

  // E a rota NÃO foi chamada — é o que distingue esta causa da outra.
  expect(chamadas.estimateRequests ?? [], 'sem endereço válido não se pergunta a taxa').toHaveLength(0);

  const cta = page.locator('#cartCtaBtn');
  await cta.click();
  await expect(page.locator('#paymentMethodModal')).toHaveClass(/active/);
  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await cta.click();
  await confirmOrderSheet(page);

  await expect(page.locator('#cartOrderError')).toContainText(/taxa de entrega/i);
  expect(chamadas.orderRequests, 'nenhum pedido pode nascer sem a taxa apurada').toHaveLength(0);
});
