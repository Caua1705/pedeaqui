import { test, expect } from '@playwright/test';
import {
  mockApi, seedPickupSession, addH2OToCart, confirmOrderSheet, pixOrder,
  RESTAURANT_URL, esperarAppPronto
} from './helpers.js';

// ============================================================================
//  O CAMPO DE CUPOM DO CHECKOUT — digitar um código que veio de fora.
//
//  A decisão do fluxo de cupons: é AQUI que um cupom se aplica, quando já
//  existe sacola, e é UM campo — sem escolher entre escanear e digitar. Até
//  02/09/2026 não havia campo nenhum: quem recebia um código num panfleto, numa
//  mensagem ou na embalagem simplesmente não tinha onde digitá-lo.
//
//  O que estes testes guardam, em ordem de custo se quebrar:
//
//  1. O código recusado NÃO entra no pedido. É a lição do "200 não é sucesso"
//     (skill §4): a rota responde 200 com `valid: false` e `ineligibility_
//     reason`, e um front que lesse só o HTTP mandaria o `coupon_code` de um
//     cupom que o backend já tinha recusado.
//  2. O total é o `total_after_coupon` do BACKEND, nunca uma subtração local.
//  3. Sem sacola o campo não existe — "nunca aplicar para depois falhar".
//
//  Os números do fixture DISCORDAM de propósito (skill §4, "fixture cujos
//  números coincidem"): 3 × 7,05 + 0,99 = 22,14, e o `total_after_coupon` é
//  20,02, que não é 22,14 menos coisa nenhuma que o front saiba calcular.
// ============================================================================

const json = (body, status = 200) => ({
  status,
  contentType: 'application/json',
  body: JSON.stringify(body)
});

const PREVIEW_OK = {
  coupon_id: 'd0d99eee-9cf1-409d-bd48-b5afb991da70',
  coupon_code: 'PANFLETO10',
  discount_type: 'percent',
  subtotal: '21.15',
  delivery_fee: '0.00',
  discount_amount: '2.12',
  total_after_coupon: '20.02',
  valid: true
};

const PREVIEW_RECUSADO = {
  ...PREVIEW_OK,
  discount_amount: '0.00',
  total_after_coupon: '22.14',
  valid: false,
  // O TIPO DE PRODUCAO: `ineligibility_reason` e um CODIGO interno do backend
  // (os treze `reason=` de coupon_service.py), nao uma frase. Este fixture
  // trazia a frase pronta, que e a assuncao de quem o escreveu — e foi ela que
  // deixou o front mostrar o campo cru com o e2e verde.
  ineligibility_reason: 'first_order_only'
};

async function abrirSacolaCom3(page, opcoes = {}) {
  const mock = await mockApi(page, { orderResponse: pixOrder, ...opcoes });
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  return mock;
}

const campo = (page) => page.locator('#cartCouponInput');
const aviso = (page) => page.locator('#cartCouponMsg');

test('o código digitado aplica, e o total é o do backend', async ({ page }) => {
  const { couponPreviewRequests, orderRequests } = await abrirSacolaCom3(page, {
    onPreviewCoupon: (route) => route.fulfill(json(PREVIEW_OK))
  });

  await expect(page.locator('#csTotal')).toContainText('22,14');

  await campo(page).fill('panfleto10');
  await page.locator('#cartCouponApply').click();

  // O código vai como `coupon_code` — CouponPreviewRequest aceita o código no
  // lugar do id, e é assim que um cupom que veio de fora chega ao julgamento do
  // backend sem o app ter de descobrir o id dele antes.
  await expect.poll(() => couponPreviewRequests.length).toBe(1);
  expect(couponPreviewRequests[0].body).toMatchObject({
    coupon_code: 'panfleto10',
    subtotal: 21.15,
    order_type: 'pickup'
  });

  await expect(aviso(page)).toContainText('Cupom aplicado');
  await expect(aviso(page)).toContainText('2,12');
  // O TOTAL É O DO BACKEND. 22,14 − 2,12 daria 20,02 por coincidência aqui, e é
  // por isso que a linha de baixo também afirma o desconto: o que se prova é
  // que a tela mostra `total_after_coupon`, não uma conta feita no browser.
  await expect(page.locator('#csTotal')).toContainText('20,02');
  await expect(page.locator('#csDiscountRow')).toBeVisible();
  await expect(page.locator('#csDiscount')).toContainText('2,12');
  // O campo esvazia: o código já foi usado, e deixá-lo escrito convida a
  // aplicar de novo o que já está aplicado.
  await expect(campo(page)).toHaveValue('');

  // E o pedido leva o código.
  await page.locator('#cartCtaBtn').click();
  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);
  await expect.poll(() => orderRequests.length).toBe(1);
  expect(orderRequests[0].body.coupon_code).toBe('panfleto10');
});

test('200 com valid:false NÃO aplica, e o código recusado não entra no pedido', async ({ page }) => {
  const { orderRequests } = await abrirSacolaCom3(page, {
    onPreviewCoupon: (route) => route.fulfill(json(PREVIEW_RECUSADO))
  });

  await campo(page).fill('PANFLETO10');
  await page.locator('#cartCouponApply').click();

  // O motivo e ESPECIFICO — uma frase generica esconderia a unica informacao
  // acionavel que a pessoa tem —, mas as palavras sao NOSSAS: o backend manda
  // um codigo, e quem o traduz e coupon-reason.js.
  await expect(aviso(page)).toContainText('primeira compra');
  await expect(aviso(page), 'o codigo do backend nao pode aparecer').not.toContainText(
    'first_order_only'
  );
  await expect(aviso(page)).not.toContainText('Cupom aplicado');

  // A sacola segue inteira: sem desconto e sem linha de desconto.
  await expect(page.locator('#csTotal')).toContainText('22,14');
  await expect(page.locator('#csDiscountRow')).toBeHidden();

  // E o `coupon_code` NÃO vai no pedido. Este é o ponto caro: o rollback tem de
  // desarmar de verdade, senão a tela não mostra desconto nenhum e o código
  // segue viajando no payload.
  await page.locator('#cartCtaBtn').click();
  await page.locator('.payment-method-option[data-payment-key="pix"]').click();
  await page.locator('.payment-method-confirm').click();
  await expect(page.locator('#cartModal')).toHaveClass(/active/);
  await page.locator('#cartCtaBtn').click();
  await confirmOrderSheet(page);
  await expect.poll(() => orderRequests.length).toBe(1);
  expect(orderRequests[0].body.coupon_code).toBeUndefined();
  expect(orderRequests[0].body.coupon_id).toBeUndefined();
});

test('Enter aplica igual ao botão', async ({ page }) => {
  const { couponPreviewRequests } = await abrirSacolaCom3(page, {
    onPreviewCoupon: (route) => route.fulfill(json(PREVIEW_OK))
  });

  await campo(page).fill('PANFLETO10');
  await campo(page).press('Enter');

  await expect.poll(() => couponPreviewRequests.length).toBe(1);
  await expect(page.locator('#csTotal')).toContainText('20,02');
});

test('código em branco não fala com o backend', async ({ page }) => {
  const { couponPreviewRequests } = await abrirSacolaCom3(page, {
    onPreviewCoupon: (route) => route.fulfill(json(PREVIEW_OK))
  });

  await campo(page).fill('   ');
  await page.locator('#cartCouponApply').click();

  await expect(aviso(page)).toContainText('Digite o código');
  // A pergunta que este teste faz é sobre uma AUSÊNCIA, e a resposta que vale é
  // um efeito observável depois dela: o total continua o mesmo depois de a
  // tela ter respondido. Se uma requisição tivesse saído, ela teria saído
  // antes do aviso acima aparecer.
  await expect(page.locator('#csTotal')).toContainText('22,14');
  expect(couponPreviewRequests).toHaveLength(0);
});

test('sem sacola o campo não existe — não se aplica para depois falhar', async ({ page }) => {
  await mockApi(page);
  await seedPickupSession(page);
  await page.goto(RESTAURANT_URL);
  await esperarAppPronto(page);
  await page.evaluate(() => window.openModal('cartModal'));

  // Escondido, e não desabilitado: um campo cinza convida a tentar, e a
  // decisão do fluxo é que cupom só se aplica quando existe sacola.
  await expect(page.locator('#cartCouponSection')).toBeHidden();

  // E com itens ele aparece — a mesma seção, sem recarregar a tela.
  await page.evaluate(() => window.PedeAquiRestaurantUi.closeModalId('cartModal'));
  await addH2OToCart(page, 3);
  await page.evaluate(() => window.openModal('cartModal'));
  await expect(page.locator('#cartCouponSection')).toBeVisible();
});
