import { test, expect } from '@playwright/test';
import {
  mockApi,
  seedPickupSession,
  addH2OToCart,
  confirmOrderSheet,
  successOrder,
  pixOrder,
  RESTAURANT_URL
} from './helpers.js';

// ============================================================================
//  O total que o cliente APROVA contra o total que o pedido TEM.
//
//  A API nao orca pedido — nao existe rota que devolva o total antes da
//  criacao. Entao `#orderConfirmTotal` sai de uma conta feita no app e
//  `#ordSuccessTotal` / `#pixOrderTotal` vem de `order.total`, calculado no
//  servidor. Duas autoridades para o mesmo numero, uma tela de distancia.
//
//  Isto nunca foi testavel porque o fixture fazia as duas contas darem 22,14:
//  3 x 7,05 + 0,99 de taxa. Divergencia nenhuma podia aparecer. Aqui a resposta
//  do pedido devolve um total DIFERENTE de proposito — que e o unico jeito de
//  provar que o app percebe em vez de trocar de numero na virada da tela.
// ============================================================================

// O que o app calcula para 3 x H2O em retirada: 21,15 + 0,99 = 22,14.
const TOTAL_CONFIRMADO = '22,14';

async function irAtePagamento(page) {
  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  const cta = page.locator('#cartCtaBtn');
  await cta.click();
  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await expect(page.locator('#paymentMethodFooter')).toBeVisible();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  return cta;
}

test('a folha de confirmacao mostra o total calculado no app', async ({ page }) => {
  // A ancora dos outros testes: e este numero que o cliente aprova.
  await mockApi(page, { orderResponse: pixOrder });
  await seedPickupSession(page);

  const cta = await irAtePagamento(page);
  await cta.click();
  await expect(page.locator('#orderConfirmSheet')).toHaveClass(/active/);
  await expect(page.locator('#orderConfirmTotal')).toHaveText(`R$ ${TOTAL_CONFIRMADO}`);
});

test('total do pedido ACIMA do confirmado e dito na tela, nao trocado em silencio', async ({
  page
}) => {
  // O caso que custa dinheiro ao cliente: ele aprovou 22,14 e o pedido nasceu
  // 27,90. Sem este aviso a tela apenas exibiria 27,90 como se sempre tivesse
  // sido esse o valor.
  await mockApi(page, {
    orderResponse: (n) => successOrder(n, { total: 27.9 })
  });
  await seedPickupSession(page);

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('[data-payment-screen-tab=delivery]').click();
  await page.locator('.payment-method-option[data-payment-key="credit:visa"]').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);

  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/);
  await expect(page.locator('#ordSuccessTotal')).toContainText('27,90');

  const aviso = page.locator('#ordSuccessMismatchRow');
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText('27,90');
  await expect(aviso).toContainText(TOTAL_CONFIRMADO);
  await expect(aviso, 'cobrar mais do que o aprovado pede acao').toContainText(
    'Confira com o restaurante'
  );
});

test('total ABAIXO do confirmado tambem e dito, sem alarme de conferencia', async ({ page }) => {
  await mockApi(page, {
    orderResponse: (n) => successOrder(n, { total: 19.0 })
  });
  await seedPickupSession(page);

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('[data-payment-screen-tab=delivery]').click();
  await page.locator('.payment-method-option[data-payment-key="credit:visa"]').click();
  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);

  const aviso = page.locator('#ordSuccessMismatchRow');
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText('19,00');
  await expect(aviso).not.toContainText('Confira com o restaurante');
});

test('totais iguais nao mostram aviso nenhum', async ({ page }) => {
  // A guarda contra alarme falso: o caminho normal nao pode ganhar um aviso.
  await mockApi(page);
  await seedPickupSession(page);

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('[data-payment-screen-tab=delivery]').click();
  await page.locator('.payment-method-option[data-payment-key="credit:visa"]').click();
  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);

  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/);
  await expect(page.locator('#ordSuccessTotal')).toContainText(TOTAL_CONFIRMADO);
  await expect(page.locator('#ordSuccessMismatchRow')).toBeHidden();
});

test('diferenca de centavo por ponto flutuante NAO vira aviso', async ({ page }) => {
  // 22,14 e o que o app calcula; 22.140000000000001 e o mesmo valor com o ruido
  // que somar floats produz. Acusar isso seria alarme em todo pedido.
  await mockApi(page, {
    orderResponse: (n) => successOrder(n, { total: 22.140000000000001 })
  });
  await seedPickupSession(page);

  await page.goto(RESTAURANT_URL);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await page.locator('#cartCtaBtn').click();
  await page.locator('[data-payment-screen-tab=delivery]').click();
  await page.locator('.payment-method-option[data-payment-key="credit:visa"]').click();
  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);

  await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/);
  await expect(page.locator('#ordSuccessMismatchRow')).toBeHidden();
});

test('na tela do Pix o aviso aparece ANTES de o cliente pagar', async ({ page }) => {
  // Onde o aviso mais importa: este total vira cobranca no proximo toque, e o
  // cliente paga antes de qualquer conferencia.
  await mockApi(page, {
    orderResponse: (n) => pixOrder(n, { total: 31.5 })
  });
  await seedPickupSession(page);

  const cta = await irAtePagamento(page);
  await cta.click();
  await expect(page.locator('#orderConfirmTotal')).toHaveText(`R$ ${TOTAL_CONFIRMADO}`);
  await confirmOrderSheet(page);

  await expect(page.locator('#pixPaymentModal')).toHaveClass(/active/);
  await expect(page.locator('#pixOrderTotal')).toContainText('31,50');

  const aviso = page.locator('#pixTotalMismatchRow');
  await expect(aviso).toBeVisible();
  await expect(aviso).toContainText('31,50');
  await expect(aviso).toContainText(TOTAL_CONFIRMADO);
  // O codigo Pix continua na tela: o aviso informa, nao bloqueia — o pedido ja
  // existe e a cobranca e valida.
  await expect(page.locator('#pixCopyCode')).toBeVisible();
});

test('o aviso e de UM pedido: o pedido seguinte, igual, nao o herda', async ({ page }) => {
  // O primeiro pedido diverge; o segundo bate. Sem a amarracao ao id do pedido,
  // o aviso do primeiro apareceria no segundo.
  await mockApi(page, {
    orderResponse: (n) => successOrder(n, n === 1 ? { total: 40 } : {})
  });
  await seedPickupSession(page);

  const pedir = async () => {
    await addH2OToCart(page, 3);
    await page.evaluate(() => window.openModal('cartModal'));
    await page.locator('#cartCtaBtn').click();
    await page.locator('[data-payment-screen-tab=delivery]').click();
    await page.locator('.payment-method-option[data-payment-key="credit:visa"]').click();
    await page.locator('#cartCtaBtn').click();
    await confirmOrderSheet(page);
    await expect(page.locator('#orderSuccessModal')).toHaveClass(/active/);
  };

  await page.goto(RESTAURANT_URL);
  await pedir();
  await expect(page.locator('#ordSuccessMismatchRow')).toBeVisible();

  await page.evaluate(() => window.RapidexActions.resolve('closeOrderSuccess')());
  await expect(page.locator('#orderSuccessModal')).not.toHaveClass(/active/);

  await pedir();
  await expect(page.locator('#ordSuccessTotal')).toContainText(TOTAL_CONFIRMADO);
  await expect(
    page.locator('#ordSuccessMismatchRow'),
    'o aviso do pedido anterior nao pode sobrar'
  ).toBeHidden();
});
