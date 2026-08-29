import { test, expect } from '@playwright/test';
import {
  mockApi,
  seedPickupSession,
  addH2OToCart,
  confirmOrderSheet,
  pixOrder,
  COUPONS,
  RESTAURANT_URL
} from './helpers.js';

// ============================================================================
//  O cupom, da vitrine ao payload do pedido.
//
//  Esta suíte não existia, e a ausência dela era a fresta: nenhum e2e chegava a
//  DESENHAR um card de cupom, porque a rota devolvia lista vazia. Passaram por
//  aqui, juntos e sem ninguém ver: a rota removida da API, o filtro `eligible`
//  que não filtrava, o rótulo "0% OFF", a tarja fixa, o botão que dizia "Usar
//  cupom" nos três estados — e o pior deles, abaixo: abrir um cupom para LER
//  aplicava o desconto e mandava o coupon_id no pedido.
// ============================================================================

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

/** Sessão logada: o Clube exige conta (mobNavClub abre o login sem token). */
async function seedLoggedSession(page) {
  await seedPickupSession(page);
  await page.addInitScript(() => {
    localStorage.setItem('rapidex.customer.token', 'e2e-club-token');
  });
}

async function mockCustomerRoutes(page) {
  await page.route(/\/customers\/me\/cashback(?:\?|$)/, (route) =>
    route.fulfill(json({ balance: 12.5, transactions: [] }))
  );
  await page.route('**/customers/me/addresses**', (route) => route.fulfill(json([])));
  await page.route('**/customers/me/orders**', (route) => route.fulfill(json([])));
  await page.route(/\/customers\/me(?:\?|$)/, (route) =>
    route.fulfill(json({ id: 'customer-e2e', name: 'E2E Test', phone: '85999999999' }))
  );
}

async function openClub(page) {
  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await page.evaluate(() => window.RapidexActions.resolve('mobNavClub')());
  await expect(page.locator('#mobViewClub')).toHaveClass(/active/);
}

test('os três estados do cupom desenham cada um com a sua frase', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLoggedSession(page);
  await mockApi(page, { onListCoupons: (route) => route.fulfill(json(COUPONS)) });
  await mockCustomerRoutes(page);

  await openClub(page);

  const cards = page.locator('.club-available-coupon-card');
  await expect(cards).toHaveCount(3);

  // APPLICABLE: o rótulo vem de `title`. Antes vinha de `discount_value`, que
  // não existe neste contrato, e o card anunciava "0% OFF".
  const aplicavel = cards.nth(0);
  await expect(aplicavel.locator('.club-available-coupon-discount')).toHaveText('5% OFF');
  // `label: "selected_for_you"` é o único selo do contrato. A tarja antiga
  // dizia "Cupom disponível" em todos os cards, inclusive neste.
  await expect(aplicavel.locator('.club-available-coupon-badge')).toHaveText(
    'Selecionado para você'
  );
  await expect(aplicavel.locator('.club-available-coupon-use')).toHaveText('Usar cupom');
  // O desconto JÁ CALCULADO pelo backend para esta sacola.
  await expect(aplicavel.locator('.club-available-coupon-meta')).toContainText(
    'Desconto de R$ 1,06'
  );

  // MISSING_AMOUNT: o botão diz o que falta, em vez de prometer aplicar.
  const falta = cards.nth(1);
  await expect(falta.locator('.club-available-coupon-discount')).toHaveText('Frete grátis');
  await expect(falta.locator('.club-available-coupon-use')).toHaveText('Faltam R$ 8,85');
  // E não anuncia "Desconto de R$ 0,00" como se fosse benefício.
  await expect(falta.locator('.club-available-coupon-meta')).not.toContainText('Desconto de');

  // LOGIN_REQUIRED: continua sendo o motivo, não um "Usar cupom" que falha.
  const login = cards.nth(2);
  await expect(login.locator('.club-available-coupon-discount')).toHaveText('10% OFF');
  await expect(login.locator('.club-available-coupon-use')).toHaveText('Entre para usar');

  // Nenhum card repete a mesma frase duas vezes: no contrato do cliente `title`
  // JÁ É o rótulo do desconto, e não há nome de campanha separado.
  await expect(aplicavel.locator('h3')).toHaveCount(0);
});

test('a lista leva o contexto da sacola, para o desconto ser o desta sacola', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedLoggedSession(page);
  const { couponListRequests } = await mockApi(page, {
    onListCoupons: (route) => route.fulfill(json(COUPONS))
  });
  await mockCustomerRoutes(page);

  await page.goto(RESTAURANT_URL);
  await page.waitForFunction(() => !document.body.classList.contains('app-booting'));
  await page.evaluate(() => window.RapidexActions.resolve('closeOperationScreen')?.());
  await addH2OToCart(page, 3); // 21,15
  await page.evaluate(() => window.RapidexActions.resolve('mobNavClub')());
  await expect(page.locator('.club-available-coupon-card').first()).toBeVisible();

  const ultima = couponListRequests.at(-1).url;
  expect(ultima).toContain('/coupons?');
  expect(ultima).toContain('subtotal=21.15');
  expect(ultima).toContain('order_type=pickup');
  // A rota morta não pode voltar por nenhum caminho.
  expect(couponListRequests.every((r) => !r.url.includes('/coupons/available'))).toBe(true);
});

// ---------------------------------------------------------------------------
//  O defeito mais caro da auditoria.
// ---------------------------------------------------------------------------

test('abrir um cupom para LER não aplica nada e não vai no pedido', async ({ page }) => {
  const { orderRequests, couponPreviewRequests } = await mockApi(page, {
    orderResponse: pixOrder
  });
  await seedPickupSession(page);

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);

  // O gesto: tocar no card só para ler as regras, e fechar pelo fundo.
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);
  await expect(page.locator('#couponDetailCode')).toHaveText('JP10');
  await page.evaluate(() => window.RapidexActions.resolve('closeCouponDetail')());
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);

  // Nenhuma validação foi disparada: ler não fala com o backend.
  await page.waitForTimeout(400);
  expect(couponPreviewRequests, 'ler um cupom não pode validá-lo').toHaveLength(0);

  // E a sacola segue sem desconto: 3 x 7,05 + 0,99 = 22,14, inteiro.
  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#csTotal')).toContainText('22,14');

  const cta = page.locator('#cartCtaBtn');
  await cta.click();
  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await expect(page.locator('#paymentMethodFooter')).toBeVisible();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await cta.click();
  await confirmOrderSheet(page);
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);

  // A asserção que importa: o pedido não carrega um cupom que ninguém escolheu.
  // Num cupom de uso único, mandá-lo aqui o QUEIMA.
  expect(orderRequests).toHaveLength(1);
  expect(orderRequests[0].body).not.toHaveProperty('coupon_id');
  expect(orderRequests[0].body).not.toHaveProperty('coupon_code');
});

test('confirmar o cupom aplica o desconto e o pedido leva o coupon_id', async ({ page }) => {
  const { orderRequests, couponPreviewRequests } = await mockApi(page, {
    orderResponse: pixOrder,
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
  await seedPickupSession(page);

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await page.locator('.coupon-detail-use').click();
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);

  expect(couponPreviewRequests).toHaveLength(1);
  expect(couponPreviewRequests[0].body).toMatchObject({ subtotal: 21.15, order_type: 'pickup' });

  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#csTotal')).toContainText('20,02');

  const cta = page.locator('#cartCtaBtn');
  await cta.click();
  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await cta.click();
  await confirmOrderSheet(page);
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);

  expect(orderRequests[0].body.coupon_id).toBe('d0d99eee-9cf1-409d-bd48-b5afb991da70');
});

test('o total exibido é o total_after_coupon do backend, não a nossa subtração', async ({
  page
}) => {
  // O desconto é 1,00 e o total antes é 22,14 — a subtração local daria 21,14.
  // O backend responde 20,90 (teto, arredondamento, o que for). O contrato diz
  // que quem calcula é ele; a tela tem que mostrar o número DELE, senão o
  // cliente confirma 21,14 e é cobrado 20,90.
  await mockApi(page, {
    orderResponse: pixOrder,
    onPreviewCoupon: (route) =>
      route.fulfill(
        json({
          coupon_id: 'd0d99eee-9cf1-409d-bd48-b5afb991da70',
          coupon_code: 'JP10',
          discount_type: 'percent',
          subtotal: '21.15',
          delivery_fee: '0.00',
          discount_amount: '1.00',
          total_after_coupon: '20.90',
          valid: true
        })
      )
  });
  await seedPickupSession(page);

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await page.locator('.coupon-detail-use').click();
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);

  await page.evaluate(() => window.openModal('cartModal'));
  const total = page.locator('#csTotal');
  await expect(total).toContainText('20,90');
  await expect(total, 'a subtração local não pode ganhar do backend').not.toContainText('21,14');
});

test('cupom recusado com 200 não vira "cupom aplicado" nem entra no pedido', async ({ page }) => {
  // O caso que ninguém lia: a rota responde 200 com `valid: false` e o motivo.
  // Antes isso virava `selectedCouponPreview = response`, a mensagem "Cupom
  // aplicado. Desconto de R$ 0,00", e o coupon_id ia no pedido assim mesmo.
  const { orderRequests } = await mockApi(page, {
    orderResponse: pixOrder,
    onPreviewCoupon: (route) =>
      route.fulfill(
        json({
          coupon_id: 'd0d99eee-9cf1-409d-bd48-b5afb991da70',
          coupon_code: 'JP10',
          discount_type: 'percent',
          subtotal: '21.15',
          delivery_fee: '0.00',
          discount_amount: '0.00',
          total_after_coupon: '22.14',
          valid: false,
          ineligibility_reason: 'Este cupom é válido apenas na primeira compra.'
        })
      )
  });
  await seedPickupSession(page);

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await page.locator('.coupon-detail-use').click();

  // O motivo do backend chega ao cliente, com as palavras dele.
  const aviso = page.locator('#couponNotice');
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText('primeira compra');
  await expect(aviso).not.toContainText('Cupom aplicado');

  // A folha NÃO fecha: o motivo está nela, e fechar jogaria a pessoa de volta
  // ao cardápio com um aviso que some. Quem decide sair é ela.
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);
  await expect(page.locator('.coupon-detail-use'), 'o botão volta ao normal').toHaveText(
    'Usar cupom'
  );
  await page.evaluate(() => window.RapidexActions.resolve('closeCouponDetail')());
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);

  // A sacola segue inteira, sem desconto.
  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#csTotal')).toContainText('22,14');

  const cta = page.locator('#cartCtaBtn');
  await cta.click();
  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await cta.click();
  await confirmOrderSheet(page);
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);

  // O cupom que o backend recusou não pode chegar ao POST /orders.
  expect(orderRequests[0].body).not.toHaveProperty('coupon_id');
  expect(orderRequests[0].body).not.toHaveProperty('coupon_code');
});

test('cupom aplicado sobrevive a abrir OUTRO cupom para leitura', async ({ page }) => {
  // O outro lado da separação: desarmar na leitura não pode desaplicar o que
  // já estava valendo.
  await mockApi(page, {
    orderResponse: pixOrder,
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
  await seedPickupSession(page);

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openCouponDetail('JP10'));
  await page.locator('.coupon-detail-use').click();
  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#csTotal')).toContainText('20,02');
  await page.evaluate(() => window.closeModal?.('cartModal'));

  // Abre outro cupom só para ler, e fecha.
  await page.evaluate(() => window.openCouponDetail('JP5'));
  await expect(page.locator('#couponDetailOverlay')).toHaveClass(/active/);
  await page.evaluate(() => window.RapidexActions.resolve('closeCouponDetail')());
  await expect(page.locator('#couponDetailOverlay')).not.toHaveClass(/active/);

  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#csTotal'), 'o cupom aplicado continua aplicado').toContainText(
    '20,02'
  );
});
