import { test, expect } from '@playwright/test';
import { mockApi, MENU, INFO, seedPickupSession, addH2OToCart, confirmOrderSheet, RESTAURANT_URL, esperarAppPronto } from './helpers.js';

// A tela de pagamento fala da FILIAL escolhida, e de mais nada.
//
// Este teste media o contrario ate 20/08/2026: ele exigia que o PIX
// SOBREVIVESSE numa filial que devolve os dois grupos vazios, recuperado do
// `settings.payment_methods` do /menu. Aquele campo era o jsonb do
// RESTAURANTE, saiu da API na revisao 20260820_0027 do backend, e o PIX que
// ele devolvia morria no checkout com 400 — `POST /orders` so consulta
// `branch_payment_methods`.
//
// O que o teste guarda agora e a metade do bug original que continua valendo,
// e que e a que de fato quebrou uma vez: **trocar de filial refaz o /info e a
// tela passa a refletir a loja nova**, em vez de manter o que a anterior
// mostrava.
test('a tela de pagamento segue a filial escolhida, sem herdar a anterior', async ({ page }) => {
  await page.setViewportSize({ width: 414, height: 896 });
  await mockApi(page);
  await seedPickupSession(page);
  const varjotaId = MENU.branches.find(branch => branch.name === 'Varjota').id;
  const requestedBranches = [];

  await page.route('**/api.pederapidex.com/**/info*', route => {
    const branchId = new URL(route.request().url()).searchParams.get('branch_id');
    requestedBranches.push(branchId);
    const info = branchId === varjotaId
      ? { ...INFO, branch: { ...INFO.branch, id: varjotaId, name: 'Varjota' }, payment_methods: { online: [], delivery: [] } }
      : INFO;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(info)
    });
  });

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);

  // A Matriz tem PIX habilitado e o mostra.
  await page.evaluate(() => window.RapidexActions.resolve('openCheckout')());
  const pix = page.locator('.payment-method-option[data-payment-scope=online][data-payment-key=pix]');
  await expect(pix).toBeVisible();
  await expect(pix).toBeEnabled();
  await page.evaluate(() => window.RapidexActions.resolve('closePaymentMethodScreen')());

  // Troca para a Varjota sem recarregar a pagina: e exatamente a troca que
  // causava o bug original.
  await page.evaluate(branchId => {
    window.RapidexActions.resolve('openOperationScreen')();
    window.RapidexActions.resolve('selectBranch')(branchId);
    window.RapidexActions.resolve('confirmOperation')();
  }, varjotaId);
  await page.evaluate(() => window.RapidexActions.resolve('openCheckout')());

  // O /info foi refeito PARA A FILIAL NOVA. E a asercao que pega a regressao
  // de verdade: sem ela, a tela poderia continuar mostrando o payload da
  // Matriz e o teste passaria pelo motivo errado.
  expect(requestedBranches).toEqual([INFO.branch.id, varjotaId]);

  // E a Varjota nao tem forma de pagamento nenhuma, entao a tela nao inventa
  // uma. O cliente ve a loja como ela esta cadastrada — que e melhor que ver
  // um PIX que o `POST /orders` recusaria com 400.
  //
  // `toBeDisabled` e nao `toHaveCount(0)`: os botoes ONLINE sao markup
  // estatico do restaurant.html, e `renderCheckoutPaymentMethods` os
  // DESABILITA em vez de remover (o CSS de 414px os esconde por cima disso).
  // Quem some do DOM e so o painel de entrega, que e montado por innerHTML.
  await expect(pix).toBeDisabled();
  await expect(page.locator('[data-payment-screen-panel=delivery] .payment-method-option')).toHaveCount(0);
});

test('pix continua disponivel quando a filial retorna payment_methods em lista', async ({ page }) => {
  await page.setViewportSize({ width: 414, height: 896 });
  await mockApi(page);
  const flatPaymentMethods = [
    ...INFO.payment_methods.online,
    ...INFO.payment_methods.delivery
  ];
  await page.route('**/api.pederapidex.com/**/info*', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ ...INFO, payment_methods: flatPaymentMethods })
  }));

  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => {
    window.act = (name, ...args) => window.RapidexActions.resolve(name)(...args);
    window.act('closeOperationScreen');
    window.act('openRestaurantInfo');
  });
  await expect(page.locator('#storeInfoPayment .store-payment-grid span')).toHaveCount(10);

  await page.evaluate(() => {
    window.act('closeModalId', 'infoModal');
    window.act('openPaymentMethodScreen');
  });
  const pix = page.locator('.payment-method-option[data-payment-scope=online][data-payment-key=pix]');
  await expect(pix).toBeVisible();
  await expect(pix).toBeEnabled();
  await pix.click();
  await expect(page.locator('#paymentMethodFooter')).toBeVisible();
});

test('pagamento na entrega replica os cartões e medidas da referência', async ({ page }) => {
  await page.setViewportSize({ width: 414, height: 896 });
  await mockApi(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => {
    window.act = (name, ...args) => window.RapidexActions.resolve(name)(...args);
    window.act('closeOperationScreen');
    window.act('openRestaurantInfo');
  });

  await expect(page.locator('#storeInfoPayment .store-payment-grid span')).toHaveCount(10);
  await page.evaluate(() => {
    window.act('closeModalId', 'infoModal');
    window.act('openPaymentMethodScreen');
  });
  await page.locator('[data-payment-screen-tab=delivery]').click();
  await expect(page.locator('#paymentMethodFooter')).toBeHidden();

  const screen = page.locator('#paymentMethodModal .payment-method-screen');
  const header = page.locator('#paymentMethodModal .payment-method-header');
  const cards = page.locator('[data-payment-screen-panel=delivery] .payment-method-option');
  const titles = page.locator('[data-payment-screen-panel=delivery] .payment-delivery-title');

  await expect(titles).toHaveText(['Crédito', 'Débito']);
  await expect(cards).toHaveCount(9);
  await expect(cards.locator('.payment-method-option-label')).toHaveText([
    'American Express', 'Elo', 'Hiper', 'Mastercard', 'Visa',
    'Elo', 'Hiper', 'Mastercard', 'Visa'
  ]);
  await expect(cards.nth(0)).toHaveAttribute('data-payment-key', 'credit:american-express');
  await expect(cards.nth(3)).toHaveAttribute('data-payment-key', 'credit:mastercard');
  await expect(cards.nth(7)).toHaveAttribute('data-payment-key', 'debit:mastercard');

  const screenBox = await screen.boundingBox();
  const headerBox = await header.boundingBox();
  const firstCardBox = await cards.nth(0).boundingBox();
  const secondCardBox = await cards.nth(1).boundingBox();
  const firstIconBox = await cards.nth(0).locator('.payment-brand-icon').boundingBox();

  expect(screenBox?.width).toBe(414);
  expect(headerBox?.height).toBe(70);
  expect(firstCardBox?.width).toBe(374);
  expect(firstCardBox?.height).toBe(64);
  expect((secondCardBox?.y || 0) - (firstCardBox?.y || 0)).toBe(74);
  expect(firstIconBox?.width).toBe(32);
  expect(firstIconBox?.height).toBe(23);

  await page.locator('[data-payment-screen-tab=online]').click();
  await page.locator('.payment-method-option[data-payment-key=pix]').click();
  await expect(page.locator('#paymentMethodFooter')).toBeVisible();
});

test('pix mantem somente a imagem original na sacola', async ({ page }) => {
  await page.setViewportSize({ width: 414, height: 896 });
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);

  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('.payment-method-option[data-payment-key=pix]').click();
  await page.locator('.payment-method-confirm').click();

  const paymentCard = page.locator('#cartModal .cart-payment-card');
  const paymentIcon = page.locator('#cartModal .cart-payment-icon');
  const pixIcon = page.locator('#cartPaymentPixIcon');
  const paymentTitle = page.locator('#cartPaymentTitle');
  const paymentLabel = page.locator('#cartPaymentLabel');
  const paymentChevron = page.locator('#cartModal .cart-payment-chevron');
  const cardBox = await paymentCard.boundingBox();
  const paymentIconBox = await paymentIcon.boundingBox();
  const pixIconBox = await pixIcon.boundingBox();
  const chevronBox = await paymentChevron.boundingBox();

  await expect(paymentCard).toHaveClass(/is-pix-payment/);
  await expect(paymentTitle).toBeHidden();
  await expect(paymentTitle).toHaveText('');
  await expect(paymentLabel).toBeVisible();
  await expect(paymentLabel).toHaveText('PIX');
  await expect(paymentIcon).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(paymentIcon).toHaveCSS('border-top-width', '0px');
  expect(cardBox?.width).toBe(374);
  expect(cardBox?.height).toBe(105);
  expect(paymentIconBox?.width).toBe(30);
  expect(paymentIconBox?.height).toBe(30);
  expect(pixIconBox?.width).toBe(30);
  expect(pixIconBox?.height).toBe(30);
  expect(chevronBox?.width).toBe(13);
  expect(chevronBox?.height).toBe(13);
});

test('bandeira volta para a sacola, monta o resumo e mantém o tipo aceito pela API', async ({ page }) => {
  await page.setViewportSize({ width: 414, height: 896 });
  const { orderRequests } = await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);

  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('[data-payment-screen-tab=delivery]').click();
  await expect(page.locator('#paymentMethodFooter')).toBeHidden();
  await page.locator('.payment-method-option[data-payment-key=\'credit:mastercard\']').click();

  await expect(page.locator('#paymentMethodModal')).not.toHaveClass(/active/);
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await expect(page.locator('#orderReviewModal')).toHaveCount(0);
  await expect(page.locator('#cartPaymentTitle')).toHaveText('Pagar na entrega');
  await expect(page.locator('#cartPaymentLabel')).toHaveText('Crédito - Mastercard');
  expect(orderRequests).toHaveLength(0);

  const summaryCard = page.locator('#cartModal .cart-payment-card');
  const summaryIcon = page.locator('#cartModal .cart-payment-icon');
  const summarySvg = page.locator('#cartPaymentDefaultIcon');
  const summaryHeading = summaryCard.locator('.cart-section-heading');
  const summaryTitle = page.locator('#cartPaymentTitle');
  const summaryDetail = page.locator('#cartPaymentLabel');
  await expect(summaryCard).not.toHaveClass(/is-pix-payment/);
  const cardBox = await summaryCard.boundingBox();
  const iconBox = await summaryIcon.boundingBox();
  const svgBox = await summarySvg.boundingBox();
  const headingBox = await summaryHeading.boundingBox();
  const titleBox = await summaryTitle.boundingBox();
  const detailBox = await summaryDetail.boundingBox();
  expect(cardBox?.width).toBe(374);
  expect(cardBox?.height).toBe(116);
  expect(iconBox?.width).toBe(50);
  expect(iconBox?.height).toBe(32);
  expect(svgBox?.width).toBe(20);
  expect(svgBox?.height).toBe(18);
  expect((headingBox?.x || 0) - (cardBox?.x || 0)).toBe(15);
  expect((headingBox?.y || 0) - (cardBox?.y || 0)).toBe(15);
  expect(headingBox?.width).toBe(344);
  expect((iconBox?.x || 0) - (cardBox?.x || 0)).toBe(15);
  expect((iconBox?.y || 0) - (cardBox?.y || 0)).toBe(65);
  expect((svgBox?.x || 0) - (iconBox?.x || 0)).toBe(15);
  expect((svgBox?.y || 0) - (iconBox?.y || 0)).toBe(7);
  expect((titleBox?.x || 0) - (cardBox?.x || 0)).toBe(80);
  expect((titleBox?.y || 0) - (cardBox?.y || 0)).toBe(61);
  expect((detailBox?.y || 0) - (cardBox?.y || 0)).toBe(83);

  await page.locator('.cart-payment-action').click();
  await expect(page.locator('[data-payment-screen-tab=delivery]')).toHaveClass(/active/);
  await expect(page.locator('#paymentMethodFooter')).toBeHidden();
  await page.locator('.payment-method-option[data-payment-key=\'credit:american-express\']').click();
  await expect(page.locator('#cartPaymentLabel')).toHaveText('Crédito - American Express');

  await page.locator('.cart-payment-action').click();
  await page.locator('.payment-method-option[data-payment-key=\'debit:elo\']').click();
  await expect(page.locator('#cartPaymentLabel')).toHaveText('Débito - Elo');

  await page.locator('.cart-payment-action').click();
  await page.locator('.payment-method-option[data-payment-key=\'credit:mastercard\']').click();
  await expect(page.locator('#cartCtaBtn')).toHaveText('Efetuar pagamento');
  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);
  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/);
  expect(orderRequests).toHaveLength(1);
  expect(orderRequests[0].body.payment_method).toBe('credit_card');
});
