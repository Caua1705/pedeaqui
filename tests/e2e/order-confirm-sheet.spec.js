import { test, expect } from '@playwright/test';
import {
  mockApi,
  seedPickupSession,
  selectPixAndReturnToCart,
  pixOrder,
  pixCharge
} from './helpers.js';

// A folha que sobe entre o botão da sacola e a criação do pedido.
//
// O que ela precisa garantir, em ordem de custo se quebrar: nenhum pedido nasce
// sem ela (era um toque só antes), "Alterar dados" devolve a sacola intacta, e
// a espera da cobrança acontece SOBRE a folha — o cliente não pode ver a loja
// nem uma tela de carregamento entre confirmar e receber o código.

test.describe.configure({ timeout: 60_000 });

test.beforeEach(async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seedPickupSession(page);
});

test('o botão da sacola abre a folha e não cria pedido nenhum', async ({ page }) => {
  const { orderRequests } = await mockApi(page, { orderResponse: pixOrder });
  await selectPixAndReturnToCart(page);

  await page.locator('#cartCtaBtn').click();

  const sheet = page.locator('#orderConfirmSheet');
  await expect(sheet).toHaveClass(/active/);
  await expect(sheet.locator('#orderConfirmTitle')).toHaveText('Confirmar sem benefício');
  await expect(sheet.locator('.order-confirm-cta')).toHaveText('Confirmar sem benefício');
  // Retirada nesta sessão: a linha diz para onde o pedido vai, e o rótulo muda com ela.
  await expect(sheet.locator('#orderConfirmWhereLabel')).toHaveText('Retirada');
  await expect(sheet.locator('#orderConfirmPaymentTitle')).toHaveText('Pagamento online');
  await expect(sheet.locator('#orderConfirmPaymentDetail')).toHaveText('PIX');
  // O total é o mesmo que a sacola mostra — a folha não recalcula nada.
  await expect(sheet.locator('#orderConfirmTotal')).toHaveText(
    await page.locator('#csTotal').innerText()
  );

  expect(orderRequests, 'abrir a folha não pode criar pedido').toHaveLength(0);
});

test('"Alterar dados" desce a folha e devolve a sacola como estava', async ({ page }) => {
  const { orderRequests } = await mockApi(page, { orderResponse: pixOrder });
  await selectPixAndReturnToCart(page);

  await page.locator('#cartCtaBtn').click();
  await expect(page.locator('#orderConfirmSheet')).toHaveClass(/active/);

  await page.locator('#orderConfirmBack').click();

  await expect(page.locator('#orderConfirmSheet')).not.toHaveClass(/active/);
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await expect(page.locator('#cartList')).toContainText('H2O');
  await expect(page.locator('#cartCtaBtn')).toHaveText('Efetuar pagamento');
  expect(orderRequests).toHaveLength(0);

  // E dá para confirmar depois de reabrir: a folha não é de uso único.
  await page.locator('#cartCtaBtn').click();
  await expect(page.locator('#orderConfirmSheet')).toHaveClass(/active/);
});

test('a espera da cobrança acontece no botão, sem tela de carregamento no meio', async ({
  page
}) => {
  // Cobrança lenta de propósito: é durante ela que a tela intermediária
  // aparecia. Com ela removida, o que tem de continuar na frente é a folha.
  await mockApi(page, {
    orderResponse: pixOrder,
    onStartPayment: async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1200));
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(pixCharge())
      });
    }
  });
  await selectPixAndReturnToCart(page);
  await page.locator('#cartCtaBtn').click();

  const cta = page.locator('#orderConfirmSheet .order-confirm-cta');
  await cta.click();

  // Durante a cobrança: bolinha no botão, folha e sacola de pé, tela do Pix
  // ainda fechada. "Alterar dados" não vale mais — o pedido já saiu daqui.
  await expect(cta).toHaveClass(/is-loading/);
  await expect(page.locator('#orderConfirmSheet')).toHaveClass(/active/);
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await expect(page.locator('#pixPaymentModal')).not.toHaveClass(/active/);
  await expect(page.locator('#orderConfirmBack')).toBeDisabled();
  expect(
    await page.locator('#pixPaymentModal [data-pix-state=loading]').count(),
    'a tela de "gerando o código" voltou'
  ).toBe(0);

  // Terminada a espera, a tela do Pix entra já com o código.
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/, { timeout: 15_000 });
  await expect(page.locator('[data-pix-state=ready]')).toBeVisible();
  await expect(page.locator('#cartModal')).not.toHaveClass(/active/);
  await expect(page.locator('#orderConfirmSheet')).not.toHaveClass(/active/);
});

test('a tela do Pix entra pela lateral, como as outras telas cheias', async ({ page }) => {
  await mockApi(page, { orderResponse: pixOrder });
  await selectPixAndReturnToCart(page);
  await page.locator('#cartCtaBtn').click();

  // O contrato da entrada lateral, e não o flagrante da animação em curso:
  // perseguir getAnimations() é uma corrida contra 300 ms de transição, e quem
  // chega atrasado lê "não animou" numa tela que animou.
  const panel = page.locator('#pixPaymentModal .modal');
  const transform = () => panel.evaluate((element) => getComputedStyle(element).transform);
  const transition = await panel.evaluate((element) => {
    const style = getComputedStyle(element);
    return { property: style.transitionProperty, duration: style.transitionDuration };
  });
  expect(transition.property).toContain('transform');
  expect(transition.duration).not.toBe('0s');

  // Fechada, a tela espera FORA da viewport, à direita: uma translação em x.
  const closed = await transform();
  expect(closed, 'a tela do Pix não nasce deslocada para o lado').toMatch(
    /^matrix\(1, 0, 0, 1, [1-9]/
  );

  await page.locator('#orderConfirmSheet .order-confirm-cta').click();
  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);
  // E termina no lugar — o deslocamento some ao fim da transição.
  await expect.poll(transform).toBe('matrix(1, 0, 0, 1, 0, 0)');
});

test('falha ao criar o pedido desce a folha e mostra o erro na sacola', async ({ page }) => {
  await mockApi(page, {
    onCreateOrder: (route) =>
      route.fulfill({
        status: 409,
        contentType: 'application/json',
        body: JSON.stringify({ detail: 'cupom já utilizado' })
      })
  });
  await selectPixAndReturnToCart(page);
  await page.locator('#cartCtaBtn').click();
  await page.locator('#orderConfirmSheet .order-confirm-cta').click();

  // O aviso mora na sacola: com a folha na frente ele seria escrito numa tela
  // que o cliente não está vendo.
  await expect(page.locator('#orderConfirmSheet')).not.toHaveClass(/active/);
  await expect(page.locator('#cartOrderError')).toBeVisible();
  await expect(page.locator('#cartList')).toContainText('H2O');
  await expect(page.locator('#cartCtaBtn')).toBeEnabled();
});
