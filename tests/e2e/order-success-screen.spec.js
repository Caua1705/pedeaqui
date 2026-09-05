import { test, expect } from '@playwright/test';
import { mockApi, RESTAURANT_URL, esperarAppPronto, seedPickupSession, addH2OToCart, confirmOrderSheet, pixOrder, trackedOrder, successOrder } from './helpers.js';

// ============================================================================
//  A ÚLTIMA TELA QUE O CLIENTE VÊ DEPOIS DE PAGAR.
//
//  Ela dava QUATRO notícias com UM título fixo no HTML — "Pedido enviado!" —
//  para: pago na entrega, Pix aprovado, cartão em análise e pagamento
//  recusado. A notícia de verdade ("Pagamento confirmado!") ficava em 13px
//  cinza embaixo. É a §17.4: a frase escolhida por uma categoria larga em vez
//  do estado, com o agravante de que uma das quatro é RUIM.
//
//  E o cashback gasto não tinha linha: `discount_total` do contrato é
//  `coupon_discount + cashback_redeemed`, então o saldo que o cliente gastou
//  entrava escondido em "Desconto", como se fosse desconto da loja.
//
//  A LARGURA É PARTE DO TESTE (§14.2).
// ============================================================================

const CELULAR = { width: 390, height: 844 };

async function pagarPix(page, detalhe) {
  await page.setViewportSize(CELULAR);
  await seedPickupSession(page);
  await mockApi(page, {
    orderResponse: pixOrder,
    onTrackOrder: (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(trackedOrder(detalhe))
    })
  });
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await page.locator('.payment-method-confirm').click();
  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);
  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/, { timeout: 30000 });
}

test('pagamento aprovado: o TITULO diz que o pagamento foi aprovado', async ({ page }) => {
  await pagarPix(page, { payment_status: 'paid', status: 'confirmed' });

  // O fato que o título fixo escondia. Sem isto, a tela do Pix pago e a do
  // pedido pago na entrega são indistinguíveis no que mais importa.
  await expect(page.locator('#ordSuccessTitle')).toHaveText('Pagamento aprovado!');
  await expect(page.locator('#ordSuccessIcon')).not.toHaveClass(/is-warning/);
  // E o nome da loja, que num app white-label não é decoração.
  await expect(page.locator('#ordSuccessStoreRow')).toBeVisible();
  await expect(page.locator('#ordSuccessStore')).not.toBeEmpty();
});

test('pago na entrega: o titulo continua "Pedido enviado!" e nao promete pagamento', async ({ page }) => {
  // O contra-exemplo, e ele é o que impede a correção de virar um título fixo
  // NOVO: um pedido sem cobrança online não teve pagamento nenhum aprovado.
  await page.setViewportSize(CELULAR);
  await seedPickupSession(page);
  await mockApi(page, { orderResponse: successOrder });
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('[data-payment-screen-tab=delivery]').click();
  // Cartao NA ENTREGA (a maquininha na porta): escolher confirma na hora e
  // volta para a sacola, sem passar por cobranca online nenhuma.
  await page.locator('.payment-method-option[data-payment-key="credit:visa"]').click();
  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);
  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/, { timeout: 30000 });

  await expect(page.locator('#ordSuccessTitle')).toHaveText('Pedido enviado!');
  await expect(page.locator('#ordSuccessTitle')).not.toContainText('aprovado');
  // Sem cobrança online não há linha de pagamento nem prazo do contrato.
  await expect(page.locator('#ordSuccessPaymentRow')).toBeHidden();
  await expect(page.locator('#ordSuccessEtaRow')).toBeHidden();
});

test('pagamento RECUSADO nao ganha check verde nem "enviado"', async ({ page }) => {
  // Este estado chega por um caminho concreto: `refreshTrackedOrder()`
  // redesenha esta tela com o que o `track` responder, e um Pix recusado
  // depois do fato vira `payment_status: failed`. Um check verde por cima de
  // "não aprovado" é a §4 desenhada — 200 não é sucesso.
  await pagarPix(page, { payment_status: 'paid', status: 'confirmed' });
  await expect(page.locator('#ordSuccessTitle')).toHaveText('Pagamento aprovado!');

  // A rota do track passa a recusar, e o cliente toca em "Atualizar status".
  await page.route(/\/orders\/track\//, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(trackedOrder({ payment_status: 'failed', status: 'pending' }))
  }));
  await page.locator('#ordSuccessTrackBtn').click();

  await expect(page.locator('#ordSuccessTitle')).toHaveText('Pagamento não aprovado');
  await expect(page.locator('#ordSuccessIcon')).toHaveClass(/is-warning/);
  await expect(page.locator('#ordSuccessIcon .success-icon-ok')).toBeHidden();
});

test('cashback gasto tem linha PROPRIA e nao se esconde dentro de "Desconto"', async ({ page }) => {
  // Os números discordam de propósito: 2,00 de cupom + 3,50 de cashback = 5,50
  // de `discount_total`. Um front que lesse só o agregado escreveria 5,50 na
  // linha de Desconto, e os 3,50 do cliente sumiriam dentro dele.
  await pagarPix(page, {
    payment_status: 'paid',
    status: 'confirmed',
    coupon_discount_amount: '2.00',
    cashback_redeemed_amount: '3.50',
    discount_total: '5.50'
  });

  await expect(page.locator('#ordSuccessDiscountRow')).toBeVisible();
  await expect(page.locator('#ordSuccessDiscount')).toHaveText('- R$ 2,00');
  await expect(page.locator('#ordSuccessCashbackRow')).toBeVisible();
  await expect(page.locator('#ordSuccessCashback')).toHaveText('- R$ 3,50');
  // E a linha de desconto NÃO pode ter engolido o cashback.
  await expect(page.locator('#ordSuccessDiscount')).not.toHaveText('- R$ 5,50');
});

test('o prazo aparece quando o contrato o traz, e SOME quando nao traz', async ({ page }) => {
  await pagarPix(page, {
    payment_status: 'paid',
    status: 'confirmed',
    order_type: 'delivery',
    delivery_eta_min: 30,
    delivery_eta_max: 45
  });
  await expect(page.locator('#ordSuccessEtaRow')).toBeVisible();
  await expect(page.locator('#ordSuccessEta')).toHaveText('Chega em 30 a 45 minutos');

  // Sem os campos, a linha SAI — nunca um "—" solto, que é a mesma regra da
  // §3.1 para dinheiro: parcela zerada é linha fora.
  await page.route(/\/orders\/track\//, route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(trackedOrder({ payment_status: 'paid', status: 'confirmed', delivery_eta_min: null, delivery_eta_max: null }))
  }));
  await page.locator('#ordSuccessTrackBtn').click();
  await expect(page.locator('#ordSuccessEtaRow')).toBeHidden();
});
